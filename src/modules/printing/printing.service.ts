import { DatabaseService } from '@/database/database.service';
import { PrinterWorkerEventsService } from '@/modules/realtime/printer-worker-events.service';
import { Prisma } from '@/generated/prisma/client';
import { PrintJobType } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
const separator = '--------------------------------';
const internalNotice = 'No válido como comprobante de pago';
const personSelect = {
  firstName: true,
  lastName: true,
  username: true,
} as const;

function personName(
  user: Prisma.UserGetPayload<{ select: typeof personSelect }>,
) {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username
  );
}

function documentDate(date: Date) {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date);
}

function documentPayload(
  id: string,
  title: string,
  header: string[],
  lines: string[],
) {
  return {
    headerLines: header.length + 1,
    lines: [
      ...header,
      title,
      `Nro. ${id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
      ...lines,
      separator,
      internalNotice,
    ],
  };
}

function paymentLines(payment: {
  paymentMethod: { name: string };
  amount: Prisma.Decimal;
  receivedAmount: Prisma.Decimal | null;
  changeAmount: Prisma.Decimal | null;
  reference: string | null;
  paidAt: Date;
  user: Prisma.UserGetPayload<{ select: typeof personSelect }> | null;
}) {
  return [
    `${payment.paymentMethod.name}: S/ ${payment.amount.toFixed(2)}`,
    `  Fecha de pago: ${documentDate(payment.paidAt)}`,
    ...(payment.user ? [`  Cajero: ${personName(payment.user)}`] : []),
    ...(payment.receivedAmount !== null
      ? [`  Recibido: S/ ${payment.receivedAmount.toFixed(2)}`]
      : []),
    ...(payment.changeAmount !== null
      ? [`  Vuelto: S/ ${payment.changeAmount.toFixed(2)}`]
      : []),
    ...(payment.reference ? [`  Referencia: ${payment.reference}`] : []),
  ];
}

@Injectable()
export class PrintingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly printerWorkerEvents: PrinterWorkerEventsService,
  ) {}

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

  async deletePrinter(id: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const printer = await tx.printer.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!printer) throw new NotFoundException('Impresora no encontrada');
      const jobs = await tx.printJob.count({ where: { printerId: id } });
      if (jobs > 0) {
        throw new ConflictException(
          'No se puede borrar una impresora con trabajos históricos; desactívala para conservar el historial',
        );
      }
      await tx.printer.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entity: 'Printer',
          entityId: id,
          userId,
          description: `Impresora eliminada: ${printer.name}`,
        },
      });
      return { id, deleted: true };
    });
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
          const parts = await tx.billPart.findMany({
            where: { orderId },
            select: { id: true, name: true },
          });
          const partById = new Map(parts.map(({ id, name }) => [id, name]));
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
          const header = await this.restaurantHeader(tx);
          const waiter = order.createdById
            ? await tx.user.findUnique({
                where: { id: order.createdById },
                select: personSelect,
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
            `Pedido #${order.number}`,
            ...tables.map(
              (table) =>
                `Mesa ${table.number}${table.name ? ` - ${table.name}` : ''}${areaById.has(table.diningAreaId) ? ` | ${areaById.get(table.diningAreaId)}` : ''}`,
            ),
            ...(waiter ? [`Mozo: ${personName(waiter)}`] : []),
            ...(order.customerName ? ['Cliente: ' + order.customerName] : []),
            ...(order.notes ? [`Observaciones: ${order.notes}`] : []),
            separator,
            ...items.flatMap((item, index) => [
              ...(index ? [separator] : []),
              ...this.ticketItemLines(item),
            ]),
            separator,
            `Subtotal: S/ ${order.subtotal.toFixed(2)}`,
            `Descuento: S/ ${order.discount.toFixed(2)}`,
            `Total del consumo: S/ ${order.total.toFixed(2)}`,
            ...(payments.length ? [separator, 'PAGOS REGISTRADOS'] : []),
            ...payments
              .map((payment) => {
                const partName =
                  payment.billPartId && partById.get(payment.billPartId);
                const label = payment.billPartId
                  ? 'Pago por productos'
                  : 'Abono';
                return [
                  `${label} ${methodById.get(payment.paymentMethodId) ?? 'Otro'}: S/ ${payment.amount.toFixed(2)}`,
                  ...(partName ? [`  Parte: ${partName}`] : []),
                ];
              })
              .flat(),
            `Total pagado: S/ ${paid.toFixed(2)}`,
            `TOTAL POR PAGAR: S/ ${pending.toFixed(2)}`,
          ];
          const baseKey = `prebill:${orderId}:${hash(
            JSON.stringify({
              header,
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
          return this.enqueueDocument(tx, {
            documentKey,
            orderId,
            printerId,
            userId,
            type: 'PREBILL',
            title: 'PRECUENTA',
            header,
            itemIds: items.map((item) => item.id),
            lines: [
              `Emitida: ${documentDate(new Date())}`,
              ...lines,
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
            include: { user: { select: personSelect } },
            orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
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
      const id = randomUUID();
      const paidAt = order?.paidAt ?? order?.payments.at(-1)?.paidAt;
      const payload = order
        ? documentPayload(
            id,
            'TICKET DE PAGO',
            await this.restaurantHeader(tx),
            [
              ...(paidAt ? [`Fecha de pago: ${documentDate(paidAt)}`] : []),
              ...(await this.orderDocumentLines(tx, order)),
              separator,
              ...order.items.flatMap((item, index) => [
                ...(index ? [separator] : []),
                ...this.ticketItemLines(item),
              ]),
              separator,
              `Subtotal: S/ ${order.subtotal.toFixed(2)}`,
              `Descuento: S/ ${order.discount.toFixed(2)}`,
              `Total de la venta: S/ ${order.total.toFixed(2)}`,
              separator,
              ...order.payments.flatMap(paymentLines),
              'Estado: PAGADO',
              'Gracias por su visita',
            ],
          )
        : { lines: ['Prueba de impresión', printer.name, message ?? ''] };
      const job = await tx.printJob.create({
        data: {
          id,
          printerId: printer.id,
          orderId,
          type: order ? PrintJobType.CUSTOMER_TICKET : PrintJobType.TEST,
          payload,
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
      this.printerWorkerEvents.notifyJobsAvailable();
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
            order: true,
            paymentMethod: true,
            user: { select: personSelect },
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
          title: 'RECIBO DE ABONO',
          header: await this.restaurantHeader(tx),
          lines: [
            ...(await this.orderDocumentLines(tx, payment.order)),
            separator,
            ...paymentLines(payment),
            `Saldo tras el abono: S/ ${payment.pendingAfter.toFixed(2)}`,
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
          include: { user: { select: personSelect } },
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
        const subtotal = part.items.reduce(
          (sum, { quantity, orderItem }) =>
            sum.add(
              orderItem.unitPrice.add(orderItem.modifiersPrice).mul(quantity),
            ),
          new Prisma.Decimal(0),
        );
        return this.enqueueDocument(tx, {
          documentKey: `part:${part.id}:${version}`,
          orderId,
          printerId,
          userId,
          type: 'PART_TICKET',
          title: 'TICKET DE PAGO',
          header: await this.restaurantHeader(tx),
          itemIds: part.items.map((item) => item.orderItemId),
          lines: [
            ...(await this.orderDocumentLines(tx, part.order)),
            `Parte: ${part.name}`,
            separator,
            ...part.items.flatMap(({ quantity, amount, orderItem }, index) => [
              ...(index ? [separator] : []),
              ...this.ticketItemLines(orderItem, quantity, amount),
            ]),
            separator,
            `Subtotal de la parte: S/ ${subtotal.toFixed(2)}`,
            `Descuento de la parte: S/ ${subtotal.sub(part.total).toFixed(2)}`,
            `Total de la parte: S/ ${part.total.toFixed(2)}`,
            ...part.payments.flatMap(paymentLines),
            'Estado de la parte: PAGADO',
          ],
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async restaurantHeader(tx: Prisma.TransactionClient) {
    const business = await tx.business.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    return [
      business?.tradeName || business?.name || 'Food Truck',
      ...(business?.documentNumber ? [business.documentNumber] : []),
      ...(business?.address ? [business.address] : []),
      ...(business?.phone ? [`Tel: ${business.phone}`] : []),
    ];
  }

  private async orderDocumentLines(
    tx: Prisma.TransactionClient,
    order: { id: string; number: number; customerName: string | null },
  ) {
    const links = await tx.orderTable.findMany({
      where: { orderId: order.id },
      select: { tableId: true },
    });
    const tables = await tx.table.findMany({
      where: { id: { in: links.map(({ tableId }) => tableId) } },
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
    });
    return [
      `Pedido #${order.number}`,
      ...tables.map(
        ({ number, name }) => `Mesa ${number}${name ? ` - ${name}` : ''}`,
      ),
      ...(order.customerName ? [`Cliente: ${order.customerName}`] : []),
    ];
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
      modifiersPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      notes: string | null;
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
      ...(!item.modifiersPrice.isZero()
        ? [
            `  Precio unitario: S/ ${item.unitPrice.add(item.modifiersPrice).toFixed(2)}`,
          ]
        : []),
      `  Total (${quantity}): S/ ${total.toFixed(2)}`,
      ...(item.notes ? [`  Nota: ${item.notes}`] : []),
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
      title: string;
      header: string[];
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
    const id = randomUUID();
    const job = await tx.printJob.create({
      data: {
        id,
        documentKey: data.documentKey,
        orderId: data.orderId,
        printerId: printer.id,
        type: data.type,
        payload: documentPayload(id, data.title, data.header, data.lines),
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
    this.printerWorkerEvents.notifyJobsAvailable();
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
