import { serializableTransaction } from '@/database/serializable-transaction';
import { DatabaseService } from '@/database/database.service';
import { FilesService } from '@/modules/files/files.service';
import {
  commandContentsSelect,
  currentCommandPayload,
  productionCommandTypes,
} from '@/modules/orders/production-command';
import { OperationsEventsService } from '@/modules/realtime/operations-events.service';
import { PrinterWorkerEventsService } from '@/modules/realtime/printer-worker-events.service';
import { formatThermalTicketDate as documentDate } from '@/shared/utils/thermal-ticket-date';
import { Prisma } from '@/generated/prisma/client';
import { PrintJobType } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  AgentCreateDto,
  AgentUpdateDto,
  JobQueryDto,
  PrinterQueryDto,
  PrinterUpdateDto,
  PrintResultDto,
  RetryPrintJobDto,
} from './printing.dto';
import {
  readyPrinter,
  retryablePrintErrorPrefix as safeError,
  uncertainPrintErrorPrefix,
} from './print-job-routing';

const agentSelect = {
  id: true,
  name: true,
  active: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PrinterAgentSelect;
const printJobDisplay = {
  printer: { select: { name: true } },
  order: {
    select: {
      number: true,
      type: true,
      tables: {
        select: { table: { select: { name: true, number: true } } },
      },
    },
  },
} satisfies Prisma.PrintJobInclude;
const cashierPrinter = {
  ...readyPrinter,
  purpose: 'CASHIER',
} satisfies Prisma.PrinterWhereInput;
const jobEventSelect = {
  id: true,
  printerId: true,
  orderId: true,
  type: true,
  status: true,
  order: { select: { createdById: true } },
} satisfies Prisma.PrintJobSelect;
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const separator = '--------------------------------';
const internalNotice = 'No válido como comprobante de pago';
const paymentFingerprint = (payments: { id: string }[]) =>
  hash(
    payments
      .map(({ id }) => id)
      .sort()
      .join(','),
  );
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

function documentPayload(
  id: string,
  title: string,
  header: string[],
  lines: string[],
  type: 'CUSTOMER_TICKET' | 'PART_TICKET' | 'PREBILL' | 'PAYMENT_RECEIPT',
  ticketNumber?: number,
) {
  const emphasizeFooter = type === 'CUSTOMER_TICKET' || type === 'PART_TICKET';
  const reference = ticketNumber === undefined
    ? id.replace(/-/g, '').slice(0, 16).toUpperCase()
    : String(ticketNumber).padStart(6, '0');
  return {
    headerLines: header.length + 1,
    emphasizeFooter,
    lines: [
      ...header,
      title,
      ...(type === 'PREBILL' ? [] : [`Nro. ${reference}`]),
      ...lines,
      ...(emphasizeFooter ? [separator, 'Gracias por su visita'] : []),
      ...(type === 'PAYMENT_RECEIPT' ? [separator, internalNotice] : []),
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
    private readonly files: FilesService,
    private readonly config: ConfigService,
    private readonly operationsEvents: OperationsEventsService,
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
    const fallbackEnabled = dto.fallbackEnabled ?? previous?.fallbackEnabled ?? false;
    const useNetwork = connectionType === 'NETWORK_TCP' || fallbackEnabled;
    const useSystem = connectionType === 'SYSTEM_PRINTER' || fallbackEnabled;
    if (
      !name ||
      !purpose ||
      (connectionType !== 'NETWORK_TCP' && connectionType !== 'SYSTEM_PRINTER')
    )
      throw new BadRequestException(
        'Indique nombre, propósito y tipo de conexión',
      );
    if (
      (useNetwork && (!host || /[\s/]/.test(host))) ||
      (useSystem && (!systemName || systemName.startsWith('-')))
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
      fallbackEnabled,
      active,
      status: active ? ('ACTIVE' as const) : ('INACTIVE' as const),
      host: useNetwork ? host : null,
      port: useNetwork ? (dto.port ?? previous?.port ?? 9100) : null,
      systemName: useSystem ? systemName : null,
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
    const where: Prisma.PrintJobWhereInput = {
      status: query.status,
      orderId: query.orderId,
      ...(query.orderNumber !== undefined && { order: { number: query.orderNumber } }),
      ...(query.ticketNumber !== undefined && {
        AND: await this.printJobTicketFilter(query.ticketNumber),
      }),
    };
    const [items, total] = await this.db.$transaction([
      this.db.printJob.findMany({
        where,
        include: printJobDisplay,
        take: query.limit,
        skip: query.offset,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.printJob.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  private async printJobTicketFilter(number: number): Promise<Prisma.PrintJobWhereInput> {
    const ticket = await this.db.paymentTicketNumber.findUnique({
      where: { number },
      select: { key: true },
    });
    if (!ticket) return { id: { in: [] } };
    const [scope, id] = ticket.key.split(':');
    const printedNumber = {
      path: ['lines'],
      array_contains: [`Nro. ${String(number).padStart(6, '0')}`],
    };
    if (scope === 'order' && id) {
      return { orderId: id, type: 'CUSTOMER_TICKET', payload: printedNumber };
    }
    if (scope === 'part' && id) {
      return {
        type: 'PART_TICKET',
        OR: [
          { documentKey: ticket.key },
          { documentKey: { startsWith: `${ticket.key}:` } },
        ],
        payload: printedNumber,
      };
    }
    return { id: { in: [] } };
  }

  async job(id: string) {
    const job = await this.db.printJob.findUnique({
      where: { id },
      include: { ...printJobDisplay, items: true },
    });
    if (!job) throw new NotFoundException('Trabajo no encontrado');
    return job;
  }

  async retryPrinters(id: string) {
    const job = await this.db.printJob.findFirst({
      where: { id, type: 'PREBILL', status: 'FAILED', error: { startsWith: safeError } },
      select: { printerId: true },
    });
    if (!job) throw new ConflictException('La precuenta no admite un reintento seguro');
    return this.db.printer.findMany({
      where: { ...cashierPrinter, id: { not: job.printerId } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async retry(id: string, userId: string, dto: RetryPrintJobDto = {}) {
    const { printerId, confirmedMissingPaper } = dto;
    const { job, order } = await serializableTransaction(this.db, async (tx) => {
      const previous = await tx.printJob.findFirst({
        where: { id, status: 'FAILED' },
        select: {
          printerId: true,
          type: true,
          attempts: true,
          error: true,
          order: jobEventSelect.order,
        },
      });
      if (!previous)
        throw new ConflictException('El trabajo no está pendiente de recuperación');
      const isCommand = productionCommandTypes.some((type) => type === previous.type);
      const confirmed = isCommand && confirmedMissingPaper &&
        previous.error?.startsWith(uncertainPrintErrorPrefix);
      if (!confirmed && !previous.error?.startsWith(safeError))
        throw new ConflictException('El trabajo no admite un reintento seguro');
      if (printerId) {
        if (previous.type !== 'PREBILL' || printerId === previous.printerId)
          throw new BadRequestException('Selecciona otra impresora para la precuenta');
        const destination = await tx.printer.findFirst({
          where: { ...cashierPrinter, id: printerId },
          select: { id: true },
        });
        if (!destination)
          throw new ConflictException('La impresora elegida no está disponible para Caja');
      }
      let payload: Prisma.InputJsonValue | undefined;
      if (isCommand) {
        const contents = await tx.printJob.findUniqueOrThrow({
          where: { id },
          select: commandContentsSelect,
        });
        payload = currentCommandPayload(contents);
        if (!payload) {
          throw new ConflictException('La comanda ya no tiene productos por imprimir');
        }
      }
      const changed = await tx.printJob.updateMany({
        where: {
          id,
          status: 'FAILED',
          error: previous.error,
          attempts: previous.attempts,
          printerId: previous.printerId,
          ...(printerId ? {} : { printer: readyPrinter }),
        },
        data: {
          status: 'PENDING',
          error: null,
          failedAt: null,
          processingAt: null,
          payload,
          ...(printerId ? { printerId } : {}),
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
          description: confirmed
            ? 'Reintento de comanda tras verificar que no salió papel'
            : 'Reintento de impresión',
          oldData: { printerId: previous.printerId, error: previous.error },
          newData: { printerId: printerId ?? previous.printerId },
        },
      });
      return {
        job: await tx.printJob.findUniqueOrThrow({ where: { id } }),
        order: previous.order,
      };
    });
    this.emitJobStatus({ ...job, order });
    this.printerWorkerEvents.notifyJobsAvailable();
    return job;
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
          ...(orderId ? { purpose: 'CASHIER' as const } : {}),
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
      const fingerprint = order && paymentFingerprint(order.payments);
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
            ],
            'CUSTOMER_TICKET',
            await this.getPaymentTicketNumber(tx, `order:${order.id}:${fingerprint}`),
          )
        : { lines: ['Prueba de impresión', printer.name, message ?? ''] };
      const job = await tx.printJob.create({
        data: {
          id,
          printerId: printer.id,
          orderId,
          type: order ? PrintJobType.CUSTOMER_TICKET : PrintJobType.TEST,
          payload: order
            ? {
                ...payload,
                paymentFingerprint: fingerprint!,
              }
            : payload,
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
    copyId?: string,
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
        const version = paymentFingerprint(part.payments);
        const ticketKey = `part:${part.id}:${version}`;
        const documentKey = copyId ? `${ticketKey}:${copyId}` : ticketKey;
        if (copyId) {
          const requestedCopy = await tx.printJob.findUnique({ where: { documentKey } });
          if (requestedCopy) return requestedCopy;
          const previous = await tx.printJob.findFirst({
            where: {
              documentKey: { startsWith: ticketKey },
              status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (previous) return previous;
        }
        const paidAt = part.payments.at(-1)?.paidAt;
        const subtotal = part.items.reduce(
          (sum, { quantity, orderItem }) =>
            sum.add(
              orderItem.unitPrice.add(orderItem.modifiersPrice).mul(quantity),
            ),
          new Prisma.Decimal(0),
        );
        return this.enqueueDocument(tx, {
          documentKey,
          orderId,
          printerId,
          userId,
          type: 'PART_TICKET',
          paymentFingerprint: version,
          paymentTicketKey: ticketKey,
          title: 'TICKET DE PAGO',
          header: await this.restaurantHeader(tx),
          itemIds: part.items.map((item) => item.orderItemId),
          lines: [
            ...(paidAt ? [`Pagado el: ${documentDate(paidAt)}`] : []),
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
    const address = business?.address?.trim();
    return [
      business?.tradeName || business?.name || 'Food Truck',
      ...(business?.documentNumber ? [business.documentNumber] : []),
      ...(address ? [address] : []),
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

  private async getPaymentTicketNumber(tx: Prisma.TransactionClient, key: string) {
    const existing = await tx.paymentTicketNumber.findUnique({ where: { key } });
    if (existing) return existing.number;
    const [ticket] = await tx.$queryRaw<{ number: number }[]>`
      INSERT INTO "payment_ticket_numbers" ("key") VALUES (${key})
      ON CONFLICT ("key") DO UPDATE SET "key" = EXCLUDED."key"
      RETURNING "number"
    `;
    return ticket.number;
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
      paymentFingerprint?: string;
      paymentTicketKey?: string;
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
        purpose: 'CASHIER',
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
    const ticketNumber = data.paymentTicketKey
      ? await this.getPaymentTicketNumber(tx, data.paymentTicketKey)
      : undefined;
    const job = await tx.printJob.create({
      data: {
        id,
        documentKey: data.documentKey,
        orderId: data.orderId,
        printerId: printer.id,
        type: data.type,
        payload: {
          ...documentPayload(
            id,
            data.title,
            data.header,
            data.lines,
            data.type,
            ticketNumber,
          ),
          ...(data.paymentFingerprint
            ? { paymentFingerprint: data.paymentFingerprint }
            : {}),
        },
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

  private receiptSignature(id: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`public-payment-ticket:v1:${id}`)
      .digest('base64url');
  }

  async publicReceipt(header?: string) {
    const unavailable = () => new NotFoundException('Ticket no disponible');
    const match =
      /^Receipt ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.([\w-]{43})$/.exec(
        header ?? '',
      );
    if (!match) throw unavailable();
    const [, id, signature] = match;
    if (
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(this.receiptSignature(id)),
      )
    )
      throw unavailable();

    const job = await this.db.printJob.findUnique({ where: { id } });
    if (
      !job?.orderId ||
      job.status !== 'PRINTED' ||
      (job.type !== 'CUSTOMER_TICKET' && job.type !== 'PART_TICKET')
    )
      throw unavailable();
    const payload = job.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Array.isArray(payload.lines) ||
      typeof payload.headerLines !== 'number' ||
      typeof payload.paymentFingerprint !== 'string'
    )
      throw unavailable();

    const partId =
      job.type === 'PART_TICKET' ? job.documentKey?.split(':')[1] : undefined;
    if (job.type === 'PART_TICKET' && !partId) throw unavailable();
    const [order, payments] = await Promise.all([
      this.db.order.findUnique({
        where: { id: job.orderId },
        select: { status: true },
      }),
      this.db.payment.findMany({
        where: {
          orderId: job.orderId,
          billPartId: partId,
          status: 'COMPLETED',
        },
        select: { id: true, paidAt: true },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    if (
      !order ||
      order.status === 'CANCELLED' ||
      (!partId && order.status !== 'PAID') ||
      payments.length === 0 ||
      paymentFingerprint(payments) !== payload.paymentFingerprint
    )
      throw unavailable();

    const lines = payload.lines.filter(
        (line): line is string =>
          typeof line === 'string' &&
          !/^\s*(Cliente|Cajero|Referencia|Nota|Observaciones):/i.test(line),
    );
    const paidAt = payments.at(-1)?.paidAt;
    const dateIndex = payload.headerLines + 1;
    if (partId && paidAt && !lines[dateIndex]?.startsWith('Pagado el:')) {
      lines.splice(dateIndex, 0, `Pagado el: ${documentDate(paidAt)}`);
    }
    const logo = await this.files.readBusinessLogo();
    return {
      lines,
      headerLines: payload.headerLines,
      logo: logo ? `data:${logo.mimeType};base64,${logo.data}` : null,
    };
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

  async claim(header?: string) {
    const { job, event, includeLogo, includeQR } = await this.db.$transaction(
      async (tx) => {
        const printerAgentId = await this.authenticate(tx, header);
        const where = {
          status: 'PENDING' as const,
          printer: { ...readyPrinter, printerAgentId },
        };
        const job = await tx.printJob.findFirst({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, printer: true },
        });
        if (!job) return { job: null };
        const [claimed] = await tx.printJob.updateManyAndReturn({
          where: { ...where, id: job.id },
          data: {
            status: 'PROCESSING',
            processingAt: new Date(),
            attempts: { increment: 1 },
          },
          select: { ...jobEventSelect, attempts: true, payload: true },
        });
        if (!claimed) return { job: null };
        const { attempts, payload, ...event } = claimed;
        return {
          event,
          includeQR:
            (event.type === 'CUSTOMER_TICKET' || event.type === 'PART_TICKET') &&
            !!payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            typeof payload.paymentFingerprint === 'string',
          includeLogo:
            event.type === 'PREBILL' ||
            event.type === 'CUSTOMER_TICKET' ||
            event.type === 'PART_TICKET',
          job: { id: job.id, attempt: attempts, payload, printer: job.printer },
        };
      },
    );
    if (event) this.emitJobStatus(event);
    if (!job || !includeLogo) return { job };
    const logo = await this.files.readBusinessLogo();
    const origin = this.config.get<string>('PUBLIC_TICKET_ORIGIN');
    return {
      job: {
        ...job,
        logoImage: logo?.data,
        ...(includeQR && origin
          ? {
              receiptUrl: new URL(
                `/ticket#${job.id}.${this.receiptSignature(job.id)}`,
                origin,
              ).href,
            }
          : {}),
      },
    };
  }

  async result(id: string, dto: PrintResultDto, header?: string) {
    const event = await this.db.$transaction(async (tx) => {
      const printerAgentId = await this.authenticate(tx, header);
      const where = { id, attempts: dto.attempt, printer: { printerAgentId } };
      const printed = dto.status === 'PRINTED';
      const [changed] = await tx.printJob.updateManyAndReturn({
        where: { ...where, status: 'PROCESSING' },
        data: {
          status: dto.status,
          printedAt: printed ? new Date() : null,
          failedAt: printed ? null : new Date(),
          error: printed
            ? null
            : (dto.safeToRetry ? safeError : uncertainPrintErrorPrefix) +
              (dto.error ?? 'Error de impresión'),
        },
        select: jobEventSelect,
      });
      if (
        !changed &&
        !(await tx.printJob.findFirst({
          where: { ...where, status: dto.status },
          select: { id: true },
        }))
      )
        throw new ConflictException('Intento de impresión no vigente');
      return changed;
    });
    if (event) this.emitJobStatus(event);
    return { ok: true };
  }

  private emitJobStatus({
    id,
    printerId,
    orderId,
    type,
    status,
    order,
  }: Prisma.PrintJobGetPayload<{ select: typeof jobEventSelect }>) {
    this.operationsEvents.emitPrintJobStatusChanged(
      { id, printerId, orderId, type, status },
      type === 'KITCHEN_COMMAND' || type === 'BAR_COMMAND' ? order?.createdById : null,
    );
  }
}
