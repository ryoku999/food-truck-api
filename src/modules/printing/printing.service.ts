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
      const order = orderId
        ? await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: { where: { status: { not: 'CANCELLED' } } },
              payments: {
                where: { status: 'COMPLETED' },
                include: { paymentMethod: true },
              },
            },
          })
        : null;
      if (orderId && !order)
        throw new NotFoundException('Pedido no encontrado');
      const lines = order
        ? [
            `Pedido #${order.number}`,
            ...order.items.map(
              (item) =>
                `${item.quantity} x ${item.productNameSnapshot}${item.variantNameSnapshot ? ' / ' + item.variantNameSnapshot : ''}  ${item.subtotal.toFixed(2)}`,
            ),
            `Total: ${order.total.toFixed(2)}`,
            ...order.payments.map(
              (payment) =>
                `${payment.paymentMethod.name}: ${payment.amount.toFixed(2)}`,
            ),
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
