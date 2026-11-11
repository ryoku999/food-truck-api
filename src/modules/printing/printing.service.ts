import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import { PrintJobType } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  AgentCreateDto,
  AgentUpdateDto,
  JobQueryDto,
  PrinterQueryDto,
  PrinterUpdateDto,
  PrintResultDto,
} from './printing.dto';

const agentSelect = {
  id: true,
  name: true,
  active: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PrinterAgentSelect;
const readyPrinter = {
  active: true,
  status: 'ACTIVE',
  printerAgent: { active: true },
} satisfies Prisma.PrinterWhereInput;
const safeError = 'RETRYABLE: ';
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function paymentLines(payment: {
  paymentMethod: { name: string };
  amount: Prisma.Decimal;
  receivedAmount: Prisma.Decimal | null;
  changeAmount: Prisma.Decimal | null;
}) {
  return [
    `${payment.paymentMethod.name}: ${payment.amount.toFixed(2)}`,
    ...(payment.receivedAmount !== null && payment.changeAmount !== null
      ? [
          `  Recibido: ${payment.receivedAmount.toFixed(2)} | Vuelto: ${payment.changeAmount.toFixed(2)}`,
        ]
      : []),
  ];
}

@Injectable()
export class PrintingService {
  constructor(private readonly db: DatabaseService) {}

  agents() {
    return this.db.printerAgent
      .findMany({ select: agentSelect, orderBy: { name: 'asc' } })
      .then((items) =>
        items.map((agent) => ({
          ...agent,
          online:
            agent.active &&
            !!agent.lastSeenAt &&
            Date.now() - agent.lastSeenAt.getTime() < 30000,
        })),
      );
  }

  async createAgent(dto: AgentCreateDto) {
    const token = randomBytes(32).toString('hex');
    const agent = await this.db.printerAgent.create({
      data: {
        name: dto.name,
        active: dto.active ?? true,
        tokenHash: hash(token),
      },
      select: agentSelect,
    });
    return { ...agent, token };
  }

  async updateAgent(id: string, dto: AgentUpdateDto) {
    await this.agentExists(id);
    return this.db.printerAgent.update({
      where: { id },
      data: { name: dto.name ?? undefined, active: dto.active ?? undefined },
      select: agentSelect,
    });
  }

  async rotate(id: string) {
    await this.agentExists(id);
    const token = randomBytes(32).toString('hex');
    await this.db.printerAgent.update({
      where: { id },
      data: { tokenHash: hash(token), lastSeenAt: null },
    });
    return { id, token };
  }

  private async agentExists(id: string) {
    if (
      !(await this.db.printerAgent.findUnique({
        where: { id },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Agente no encontrado');
  }

  printers(query: PrinterQueryDto) {
    return this.db.printer.findMany({
      where: { purpose: query.purpose, printerAgentId: query.printerAgentId },
      orderBy: { name: 'asc' },
    });
  }

  async savePrinter(dto: PrinterUpdateDto, id?: string) {
    const previous = id
      ? await this.db.printer.findUnique({ where: { id } })
      : null;
    if (id && !previous) throw new NotFoundException('Impresora no encontrada');
    const name = dto.name?.trim() ?? previous?.name;
    const purpose = dto.purpose ?? previous?.purpose;
    const connectionType = dto.connectionType ?? previous?.connectionType;
    const host = dto.host?.trim() ?? previous?.host;
    const systemName = dto.systemName?.trim() ?? previous?.systemName;
    if (
      !name ||
      !purpose ||
      (connectionType !== 'NETWORK_TCP' && connectionType !== 'SYSTEM_PRINTER')
    )
      throw new BadRequestException(
        'Indique nombre, propósito y tipo de conexión',
      );
    if (
      connectionType === 'NETWORK_TCP'
        ? !host || /[\s/]/.test(host)
        : !systemName || systemName.startsWith('-')
    )
      throw new BadRequestException('Destino de impresión inválido');
    if (dto.printerAgentId) await this.agentExists(dto.printerAgentId);
    if (
      dto.productionAreaId &&
      !(await this.db.productionArea.findUnique({
        where: { id: dto.productionAreaId },
      }))
    )
      throw new NotFoundException('Área de producción no encontrada');
    const active = dto.active ?? previous?.active ?? true;
    const data = {
      name,
      purpose,
      connectionType,
      active,
      status: active ? ('ACTIVE' as const) : ('INACTIVE' as const),
      host: connectionType === 'NETWORK_TCP' ? host : null,
      port:
        connectionType === 'NETWORK_TCP'
          ? (dto.port ?? previous?.port ?? 9100)
          : null,
      systemName: connectionType === 'SYSTEM_PRINTER' ? systemName : null,
      paperWidth: dto.paperWidth ?? undefined,
      printerAgentId: dto.printerAgentId,
      productionAreaId: dto.productionAreaId,
    };
    return id
      ? this.db.printer.update({ where: { id }, data })
      : this.db.printer.create({ data });
  }

  async jobs(query: JobQueryDto) {
    const where = { status: query.status, orderId: query.orderId };
    const [items, total] = await this.db.$transaction([
      this.db.printJob.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.printJob.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async job(id: string) {
    const job = await this.db.printJob.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!job) throw new NotFoundException('Trabajo no encontrado');
    return job;
  }

  async retry(id: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.printJob.updateMany({
        where: {
          id,
          status: 'FAILED',
          error: { startsWith: safeError },
          printer: readyPrinter,
        },
        data: {
          status: 'PENDING',
          error: null,
          failedAt: null,
          processingAt: null,
        },
      });
      if (!changed.count)
        throw new ConflictException('El trabajo no admite un reintento seguro');
      await tx.auditLog.create({
        data: {
          action: 'PRINT',
          entity: 'PrintJob',
          entityId: id,
          userId,
          description: 'Reintento de impresión',
        },
      });
      return tx.printJob.findUniqueOrThrow({ where: { id } });
    });
  }

  async enqueuePrebill(
    orderId: string,
    printerId: string | undefined,
    userId: string,
    copyId?: string,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (!order) throw new NotFoundException('Pedido no encontrado');
          if (['DRAFT', 'PAID', 'CANCELLED'].includes(order.status)) {
            throw new ConflictException(
              'La precuenta requiere un pedido enviado y abierto',
            );
          }
          const items = await this.ticketItems(tx, {
            orderId,
            status: { not: 'CANCELLED' },
          });
          if (items.some((item) => item.status === 'DRAFT')) {
            throw new ConflictException(
              'Envía los productos nuevos antes de imprimir la precuenta',
            );
          }
          if (!items.length)
            throw new ConflictException(
              'El pedido no tiene productos vigentes',
            );
          const payments = await tx.payment.findMany({
            where: { orderId, status: 'COMPLETED' },
            orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
          });
          const methods = await tx.paymentMethod.findMany({
            where: {
              id: { in: payments.map((payment) => payment.paymentMethodId) },
            },
          });
          const links = await tx.orderTable.findMany({
            where: { orderId },
            select: { tableId: true },
          });
          const tables = await tx.table.findMany({
            where: { id: { in: links.map((link) => link.tableId) } },
            orderBy: [{ number: 'asc' }, { id: 'asc' }],
          });
          const areas = await tx.diningArea.findMany({
            where: { id: { in: tables.map((table) => table.diningAreaId) } },
          });
          const business = await tx.business.findFirst({
            orderBy: { createdAt: 'asc' },
          });
          const waiter = order.createdById
            ? await tx.user.findUnique({
                where: { id: order.createdById },
                select: { username: true, firstName: true, lastName: true },
              })
            : null;
          const methodById = new Map(
            methods.map((method) => [method.id, method.name]),
          );
          const areaById = new Map(areas.map((area) => [area.id, area.name]));
          const paid = payments.reduce(
            (sum, payment) => sum.add(payment.amount),
            new Prisma.Decimal(0),
          );
          const pending = Prisma.Decimal.max(order.total.sub(paid), 0);
          const lines = [
            business?.tradeName || business?.name || 'Food Truck',
            ...(business?.documentNumber ? [business.documentNumber] : []),
            ...(business?.address ? [business.address] : []),
            ...(business?.phone ? ['Tel: ' + business.phone] : []),
            'PRECUENTA',
            'Pendiente de pago',
            `Pedido #${order.number}`,
            ...tables.map(
              (table) =>
                `${areaById.get(table.diningAreaId)} - ${table.name || 'Mesa ' + table.number}`,
            ),
            ...(waiter
              ? [
                  'Mozo: ' +
                    ([waiter.firstName, waiter.lastName]
                      .filter(Boolean)
                      .join(' ') || waiter.username),
                ]
              : []),
            ...(order.customerName ? ['Cliente: ' + order.customerName] : []),
            '--------------------------------',
            ...items.flatMap((item) => this.ticketItemLines(item)),
            '--------------------------------',
            `Subtotal: S/ ${order.subtotal.toFixed(2)}`,
            `Descuento: S/ ${order.discount.toFixed(2)}`,
            `Total: S/ ${order.total.toFixed(2)}`,
            ...payments.map(
              (payment) =>
                `Abono ${methodById.get(payment.paymentMethodId)}: S/ ${payment.amount.toFixed(2)}`,
            ),
            `Abonos: S/ ${paid.toFixed(2)}`,
            `SALDO PENDIENTE: S/ ${pending.toFixed(2)}`,
          ];
          const baseKey = `prebill:${orderId}:${hash(
            JSON.stringify({
              lines,
              items: items.map((item) => item.id),
              payments: payments.map((payment) => payment.id),
            }),
          )}`;
          const documentKey = copyId ? `${baseKey}:${copyId}` : baseKey;
          const requested = await tx.printJob.findUnique({
            where: { documentKey },
          });
          if (requested) return requested;
          const unfinished = await tx.printJob.findFirst({
            where: {
              documentKey: { startsWith: baseKey },
              status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (unfinished) return unfinished;
          const generatedAt = new Date();
          const time = new Intl.DateTimeFormat('es-PE', {
            timeZone: 'America/Lima',
            dateStyle: 'short',
            timeStyle: 'medium',
            hourCycle: 'h23',
          }).format(generatedAt);
          return this.enqueueDocument(tx, {
            documentKey,
            orderId,
            printerId,
            userId,
            type: 'PREBILL',
            itemIds: items.map((item) => item.id),
            lines: [
              ...lines.slice(
                0,
                lines.indexOf('--------------------------------'),
              ),
              `Emitida: ${time} | Lima`,
              ...lines.slice(lines.indexOf('--------------------------------')),
              'Pedido abierto - cuenta informativa',
            ],
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException(
          'La cuenta cambió durante la impresión. Actualiza la cola y vuelve a intentarlo',
        );
      }
      throw error;
    }
  }

  async enqueue(
    printerId: string | undefined,
    userId: string,
    orderId?: string,
    message?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const printer = await tx.printer.findFirst({
        where: {
          ...readyPrinter,
          id: printerId,
          ...(orderId ? { purpose: { in: ['CASHIER', 'GENERAL'] } } : {}),
        },
        orderBy: [{ purpose: 'asc' }, { id: 'asc' }],
      });
      if (!printer)
        throw new NotFoundException(
          'No hay una impresora activa asignada a un agente',
        );
      const orderRow = orderId
        ? await tx.order.findUnique({ where: { id: orderId } })
        : null;
      const orderItems = orderRow
        ? await this.ticketItems(tx, {
            orderId: orderRow.id,
            status: { not: 'CANCELLED' },
          })
        : [];
      const payments = orderRow
        ? await tx.payment.findMany({
            where: { orderId: orderRow.id, status: 'COMPLETED' },
          })
        : [];
      const methods = payments.length
        ? await tx.paymentMethod.findMany({
            where: {
              id: { in: payments.map((payment) => payment.paymentMethodId) },
            },
          })
        : [];
      const methodById = new Map(methods.map((method) => [method.id, method]));
      const order = orderRow
        ? {
            ...orderRow,
            items: orderItems,
            payments: payments.map((payment) => ({
              ...payment,
              paymentMethod: methodById.get(payment.paymentMethodId)!,
            })),
          }
        : null;
      if (orderId && !order)
        throw new NotFoundException('Pedido no encontrado');
      if (order && order.status !== 'PAID') {
        throw new ConflictException(
          'El ticket general requiere un pedido pagado',
        );
      }
      const lines = order
        ? [
            `Pedido #${order.number}`,
            ...order.items.flatMap((item) => this.ticketItemLines(item)),
            `Total: S/ ${order.total.toFixed(2)}`,
            ...order.payments.flatMap(paymentLines),
          ]
        : ['Prueba de impresión', printer.name, message ?? ''];
      const job = await tx.printJob.create({
        data: {
          printerId: printer.id,
          orderId,
          type: order ? PrintJobType.CUSTOMER_TICKET : PrintJobType.TEST,
          payload: { lines },
          items: {
            create:
              order?.items.map((item) => ({ orderItemId: item.id })) ?? [],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'PRINT',
          entity: 'PrintJob',
          entityId: job.id,
          userId,
          description: job.type,
        },
      });
      return job;
    });
  }

  enqueueReceipt(
    paymentId: string,
    printerId: string | undefined,
    userId: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: {
            order: { select: { number: true, status: true } },
            paymentMethod: true,
          },
        });
        if (!payment) throw new NotFoundException('Pago no encontrado');
        if (
          payment.billPartId ||
          payment.status !== 'COMPLETED' ||
          payment.pendingAfter === null ||
          payment.order.status === 'CANCELLED'
        ) {
          throw new ConflictException('Este pago no admite un recibo de abono');
        }
        return this.enqueueDocument(tx, {
          documentKey: `payment:${payment.id}`,
          orderId: payment.orderId,
          printerId,
          userId,
          type: 'PAYMENT_RECEIPT',
          lines: [
            'Recibo interno de abono',
            `Pedido #${payment.order.number}`,
            ...paymentLines(payment),
            `Saldo tras el abono: ${payment.pendingAfter.toFixed(2)}`,
          ],
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  enqueuePartTicket(
    orderId: string,
    partId: string,
    printerId: string | undefined,
    userId: string,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.billPart.findUnique({
          where: { id: partId, orderId },
        });
        if (!row)
          throw new NotFoundException('Parte no encontrada en este pedido');
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { number: true, status: true },
        });
        const items = await tx.billPartItem.findMany({
          where: { billPartId: partId },
          orderBy: { orderItemId: 'asc' },
        });
        const orderItems = await this.ticketItems(tx, {
          id: { in: items.map(({ orderItemId }) => orderItemId) },
        });
        const payments = await tx.payment.findMany({
          where: { billPartId: partId, status: 'COMPLETED' },
          orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        });
        const methods = await tx.paymentMethod.findMany({
          where: {
            id: { in: payments.map(({ paymentMethodId }) => paymentMethodId) },
          },
        });
        const itemById = new Map(orderItems.map((item) => [item.id, item]));
        const methodById = new Map(
          methods.map((method) => [method.id, method]),
        );
        const part = {
          ...row,
          order,
          items: items.map((item) => ({
            ...item,
            orderItem: itemById.get(item.orderItemId)!,
          })),
          payments: payments.map((payment) => ({
            ...payment,
            paymentMethod: methodById.get(payment.paymentMethodId)!,
          })),
        };
        const paid = part.payments.reduce(
          (total, payment) => total.add(payment.amount),
          new Prisma.Decimal(0),
        );
        if (!paid.equals(part.total) || part.order.status === 'CANCELLED') {
          throw new ConflictException(
            'Completa el pago de esta parte antes de imprimir',
          );
        }
        const version = hash(
          part.payments
            .map((payment) => payment.id)
            .sort()
            .join(','),
        );
        return this.enqueueDocument(tx, {
          documentKey: `part:${part.id}:${version}`,
          orderId,
          printerId,
          userId,
          type: 'PART_TICKET',
          itemIds: part.items.map((item) => item.orderItemId),
          lines: [
            `Pedido #${part.order.number} | ${part.name}`,
            ...part.items.flatMap(({ quantity, amount, orderItem }) =>
              this.ticketItemLines(orderItem, quantity, amount),
            ),
            `Total de la parte: S/ ${part.total.toFixed(2)}`,
            ...part.payments.flatMap(paymentLines),
          ],
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async ticketItems(
    tx: Prisma.TransactionClient,
    where: Prisma.OrderItemWhereInput,
  ) {
    const items = await tx.orderItem.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const ids = items.map((item) => item.id);
    const modifiers = await tx.orderItemModifier.findMany({
      where: { orderItemId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const combos = await tx.orderItemComboSelection.findMany({
      where: { orderItemId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return items.map((item) => ({
      ...item,
      modifiers: modifiers.filter((option) => option.orderItemId === item.id),
      comboSelections: combos.filter(
        (option) => option.orderItemId === item.id,
      ),
    }));
  }

  private ticketItemLines(
    item: {
      productNameSnapshot: string;
      variantNameSnapshot: string | null;
      quantity: number;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      modifiers: {
        groupNameSnapshot: string;
        optionNameSnapshot: string;
        priceDelta: Prisma.Decimal;
        quantity: number;
      }[];
      comboSelections: {
        groupNameSnapshot: string;
        productNameSnapshot: string;
        additionalPrice: Prisma.Decimal;
      }[];
    },
    quantity = item.quantity,
    total = item.subtotal,
  ) {
    const signed = (amount: Prisma.Decimal) =>
      `${amount.isNegative() ? '-' : '+'}S/ ${amount.abs().toFixed(2)}`;
    return [
      `${quantity} x ${item.productNameSnapshot}${item.variantNameSnapshot ? ' / ' + item.variantNameSnapshot : ''}`,
      `  Base: S/ ${item.unitPrice.toFixed(2)} c/u`,
      ...item.modifiers.map(
        (option) =>
          `  ${option.groupNameSnapshot}: ${option.quantity > 1 ? option.quantity + ' x ' : ''}${option.optionNameSnapshot} (${signed(option.priceDelta)} c/u)`,
      ),
      ...item.comboSelections.map(
        (option) =>
          `  ${option.groupNameSnapshot}: ${option.productNameSnapshot} (${signed(option.additionalPrice)} c/u)`,
      ),
      `  Total (${quantity}): S/ ${total.toFixed(2)}`,
    ];
  }

  private async enqueueDocument(
    tx: Prisma.TransactionClient,
    data: {
      documentKey: string;
      orderId: string;
      printerId?: string;
      userId: string;
      type: 'PAYMENT_RECEIPT' | 'PART_TICKET' | 'PREBILL';
      lines: string[];
      itemIds?: string[];
    },
  ) {
    const existing = await tx.printJob.findUnique({
      where: { documentKey: data.documentKey },
    });
    if (existing) return existing;
    const printer = await tx.printer.findFirst({
      where: {
        ...readyPrinter,
        id: data.printerId,
        purpose: { in: ['CASHIER', 'GENERAL'] },
      },
      orderBy: [{ purpose: 'asc' }, { id: 'asc' }],
    });
    if (!printer)
      throw new NotFoundException(
        'No hay una impresora activa asignada a un agente',
      );
    await tx.order.update({
      where: { id: data.orderId },
      data: { updatedAt: new Date() },
    });
    const job = await tx.printJob.create({
      data: {
        documentKey: data.documentKey,
        orderId: data.orderId,
        printerId: printer.id,
        type: data.type,
        payload: { lines: data.lines },
        items: {
          create: data.itemIds?.map((orderItemId) => ({ orderItemId })) ?? [],
        },
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'PRINT',
        entity: 'PrintJob',
        entityId: job.id,
        userId: data.userId,
        description: job.type,
      },
    });
    return job;
  }

  private async authenticate(tx: Prisma.TransactionClient, header?: string) {
    const token = /^Bearer ([a-f0-9]{64})$/i.exec(header ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    const agent = await tx.printerAgent.updateManyAndReturn({
      where: { tokenHash: hash(token), active: true },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    });
    if (!agent.length) throw new UnauthorizedException();
    return agent[0].id;
  }

  claim(header?: string) {
    return this.db.$transaction(async (tx) => {
      const printerAgentId = await this.authenticate(tx, header);
      const where = {
        status: 'PENDING' as const,
        printer: { ...readyPrinter, printerAgentId },
      };
      const job = await tx.printJob.findFirst({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { printer: true },
      });
      if (!job) return { job: null };
      const changed = await tx.printJob.updateMany({
        where: { ...where, id: job.id },
        data: {
          status: 'PROCESSING',
          processingAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      return {
        job: changed.count
          ? {
              id: job.id,
              attempt: job.attempts + 1,
              payload: job.payload,
              printer: job.printer,
            }
          : null,
      };
    });
  }

  result(id: string, dto: PrintResultDto, header?: string) {
    return this.db.$transaction(async (tx) => {
      const printerAgentId = await this.authenticate(tx, header);
      const where = { id, attempts: dto.attempt, printer: { printerAgentId } };
      const printed = dto.status === 'PRINTED';
      const changed = await tx.printJob.updateMany({
        where: { ...where, status: 'PROCESSING' },
        data: {
          status: dto.status,
          printedAt: printed ? new Date() : null,
          failedAt: printed ? null : new Date(),
          error: printed
            ? null
            : (dto.safeToRetry ? safeError : 'UNCERTAIN: ') +
              (dto.error ?? 'Error de impresión'),
        },
      });
      if (
        !changed.count &&
        !(await tx.printJob.findFirst({
          where: { ...where, status: dto.status },
          select: { id: true },
        }))
      )
        throw new ConflictException('Intento de impresión no vigente');
      return { ok: true };
    });
  }
}
