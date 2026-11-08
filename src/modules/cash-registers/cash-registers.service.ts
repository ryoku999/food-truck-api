import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AuditAction,
  CashMovementType,
  CashSessionStatus,
  PaymentStatus,
} from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashRegisterIdParamDto,
  CashRegisterQueryDto,
  CashSessionIdParamDto,
  CloseCashSessionDto,
  CreateCashMovementDto,
  CreateCashRegisterDto,
  CurrentCashSessionQueryDto,
  OpenCashSessionDto,
  UpdateCashRegisterDto,
} from './dto/cash-register.dto';
import {
  CashMovementResponse,
  CashCollectionsResponse,
  CashRegisterResponse,
  CashSessionResponse,
} from './interfaces/cash-register.interface';

const USER_SELECT = { id: true, username: true } as const;
const MOVEMENT_SELECT = {
  id: true,
  cashSessionId: true,
  type: true,
  amount: true,
  description: true,
  paymentId: true,
  user: { select: USER_SELECT },
  createdAt: true,
} satisfies Prisma.CashMovementSelect;
const SESSION_SELECT = {
  id: true,
  cashRegisterId: true,
  status: true,
  openingAmount: true,
  expectedAmount: true,
  actualAmount: true,
  difference: true,
  openedAt: true,
  closedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  cashRegister: { select: { id: true, name: true, active: true } },
  openedBy: { select: USER_SELECT },
  closedBy: { select: USER_SELECT },
  movements: { select: MOVEMENT_SELECT, orderBy: { createdAt: 'asc' } },
  payments: {
    where: {
      status: {
        in: [
          PaymentStatus.COMPLETED,
          PaymentStatus.CANCELLED,
          PaymentStatus.REFUNDED,
        ],
      },
    },
    select: {
      status: true,
      amount: true,
      cashMovement: { select: { id: true } },
      paymentMethod: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.CashRegisterSessionSelect;
const REGISTER_SELECT = {
  id: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { sessions: true } },
  sessions: {
    where: { status: CashSessionStatus.OPEN },
    select: {
      id: true,
      openedAt: true,
      openedBy: { select: USER_SELECT },
    },
    take: 1,
  },
} satisfies Prisma.CashRegisterSelect;

type RegisterRecord = Prisma.CashRegisterGetPayload<{
  select: typeof REGISTER_SELECT;
}>;
type SessionRecord = Prisma.CashRegisterSessionGetPayload<{
  select: typeof SESSION_SELECT;
}>;
type MovementRecord = Prisma.CashMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

@Injectable()
export class CashRegistersService {
  constructor(private readonly db: DatabaseService) {}

  async createRegister(
    dto: CreateCashRegisterDto,
  ): Promise<CashRegisterResponse> {
    try {
      const register = await this.db.cashRegister.create({
        data: dto,
        select: REGISTER_SELECT,
      });
      return this.toRegisterResponse(register);
    } catch (error: unknown) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  async findAllRegisters(
    query: CashRegisterQueryDto,
  ): Promise<CashRegisterResponse[]> {
    const registers = await this.db.cashRegister.findMany({
      where: {
        active: query.active,
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      select: REGISTER_SELECT,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return registers.map((register) => this.toRegisterResponse(register));
  }

  async updateRegister(
    params: CashRegisterIdParamDto,
    dto: UpdateCashRegisterDto,
  ): Promise<CashRegisterResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    if (dto.active === false) {
      const openSession = await this.db.cashRegisterSession.findFirst({
        where: { cashRegisterId: params.id, status: CashSessionStatus.OPEN },
        select: { id: true },
      });
      if (openSession) {
        throw new ConflictException(
          'No puede desactivar una caja con una sesion abierta',
        );
      }
    }
    try {
      const updated = await this.db.cashRegister.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1)
        throw new NotFoundException('Caja no encontrada');
      const register = await this.db.cashRegister.findUnique({
        where: { id: params.id },
        select: REGISTER_SELECT,
      });
      if (!register) throw new NotFoundException('Caja no encontrada');
      return this.toRegisterResponse(register);
    } catch (error: unknown) {
      this.rethrowNameConflict(error);
      throw error;
    }
  }

  async openSession(
    dto: OpenCashSessionDto,
    user: AuthenticatedUser,
  ): Promise<CashSessionResponse> {
    const sessionId = await this.db.$transaction(
      async (tx) => {
        const register = await tx.cashRegister.findUnique({
          where: { id: dto.cashRegisterId },
          select: { id: true, name: true, active: true },
        });
        if (!register) throw new NotFoundException('Caja no encontrada');
        if (!register.active)
          throw new ConflictException('La caja esta inactiva');
        const current = await tx.cashRegisterSession.findFirst({
          where: {
            cashRegisterId: register.id,
            status: CashSessionStatus.OPEN,
          },
          select: { id: true },
        });
        if (current)
          throw new ConflictException('La caja ya tiene una sesion abierta');

        const openingAmount = new Prisma.Decimal(dto.openingAmount);
        const session = await tx.cashRegisterSession.create({
          data: {
            cashRegisterId: register.id,
            openingAmount,
            openedById: user.id,
            notes: dto.notes,
          },
          select: { id: true },
        });
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: CashMovementType.OPENING,
            amount: openingAmount,
            description: 'Fondo inicial',
            userId: user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.OPEN_CASH,
            entity: 'CashRegisterSession',
            entityId: session.id,
            description: `Apertura de ${register.name} con ${openingAmount.toFixed(2)}`,
          },
        });
        return session.id;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getSession(sessionId);
  }

  async findCurrentSession(
    query: CurrentCashSessionQueryDto,
  ): Promise<CashSessionResponse> {
    const session = await this.db.cashRegisterSession.findFirst({
      where: {
        cashRegisterId: query.cashRegisterId,
        status: CashSessionStatus.OPEN,
      },
      select: SESSION_SELECT,
    });
    if (!session)
      throw new NotFoundException(
        'No existe una sesion abierta para esta caja',
      );
    return this.toSessionResponse(session);
  }

  findSession(params: CashSessionIdParamDto): Promise<CashSessionResponse> {
    return this.getSession(params.id);
  }

  async createMovement(
    params: CashSessionIdParamDto,
    dto: CreateCashMovementDto,
    user: AuthenticatedUser,
  ): Promise<CashMovementResponse> {
    if (dto.type === CashMovementType.ADJUSTMENT && dto.amount === 0) {
      throw new BadRequestException('El ajuste no puede ser cero');
    }
    const movement = await this.db.$transaction(
      async (tx) => {
        const session = await tx.cashRegisterSession.findUnique({
          where: { id: params.id },
          select: { id: true, status: true },
        });
        if (!session)
          throw new NotFoundException('Sesion de caja no encontrada');
        if (session.status !== CashSessionStatus.OPEN) {
          throw new ConflictException('La sesion de caja esta cerrada');
        }
        await tx.cashRegisterSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });
        const created = await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: dto.type,
            amount: new Prisma.Decimal(dto.amount),
            description: dto.description,
            userId: user.id,
          },
          select: MOVEMENT_SELECT,
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.UPDATE,
            entity: 'CashMovement',
            entityId: created.id,
            description: `${dto.type} de ${new Prisma.Decimal(dto.amount).toFixed(2)}: ${dto.description}`,
          },
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.toMovementResponse(movement);
  }

  async closeSession(
    params: CashSessionIdParamDto,
    dto: CloseCashSessionDto,
    user: AuthenticatedUser,
  ): Promise<CashSessionResponse> {
    await this.db.$transaction(
      async (tx) => {
        const session = await tx.cashRegisterSession.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            status: true,
            openingAmount: true,
            notes: true,
            cashRegister: { select: { name: true } },
            movements: { select: { type: true, amount: true } },
          },
        });
        if (!session)
          throw new NotFoundException('Sesion de caja no encontrada');
        if (session.status !== CashSessionStatus.OPEN) {
          throw new ConflictException('La sesion de caja ya esta cerrada');
        }
        const expected = this.calculateExpected(
          session.openingAmount,
          session.movements,
        );
        const actual = new Prisma.Decimal(dto.actualAmount);
        const difference = actual.sub(expected);
        await tx.cashRegisterSession.update({
          where: { id: session.id },
          data: {
            status: CashSessionStatus.CLOSED,
            expectedAmount: expected,
            actualAmount: actual,
            difference,
            closedById: user.id,
            closedAt: new Date(),
            notes: dto.notes ?? session.notes,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CLOSE_CASH,
            entity: 'CashRegisterSession',
            entityId: session.id,
            description: `Cierre de ${session.cashRegister.name}: esperado ${expected.toFixed(2)}, contado ${actual.toFixed(2)}, diferencia ${difference.toFixed(2)}`,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getSession(params.id);
  }

  private async getSession(id: string): Promise<CashSessionResponse> {
    const session = await this.db.cashRegisterSession.findUnique({
      where: { id },
      select: SESSION_SELECT,
    });
    if (!session) throw new NotFoundException('Sesion de caja no encontrada');
    return this.toSessionResponse(session);
  }

  private calculateExpected(
    openingAmount: Prisma.Decimal,
    movements: { type: CashMovementType; amount: Prisma.Decimal }[],
  ): Prisma.Decimal {
    return movements.reduce((total, movement) => {
      if (movement.type === CashMovementType.OPENING) return total;
      if (
        movement.type === CashMovementType.EXPENSE ||
        movement.type === CashMovementType.WITHDRAWAL
      ) {
        return total.sub(movement.amount);
      }
      return total.add(movement.amount);
    }, openingAmount);
  }

  private toRegisterResponse(register: RegisterRecord): CashRegisterResponse {
    const { _count, sessions, ...data } = register;
    return {
      ...data,
      sessionCount: _count.sessions,
      currentSession: sessions[0] ?? null,
    };
  }

  private toMovementResponse(movement: MovementRecord): CashMovementResponse {
    return { ...movement, amount: movement.amount.toString() };
  }

  private toSessionResponse(session: SessionRecord): CashSessionResponse {
    const { payments, ...data } = session;
    const summary = Object.values(CashMovementType).reduce(
      (result, type) => ({ ...result, [type]: '0' }),
      {} as Record<CashMovementType, string>,
    );
    for (const movement of session.movements) {
      summary[movement.type] = new Prisma.Decimal(summary[movement.type])
        .add(movement.amount)
        .toString();
    }
    const liveExpectedAmount = this.calculateExpected(
      session.openingAmount,
      session.movements,
    ).toString();
    return {
      ...data,
      openingAmount: session.openingAmount.toString(),
      expectedAmount: session.expectedAmount?.toString() ?? null,
      actualAmount: session.actualAmount?.toString() ?? null,
      difference: session.difference?.toString() ?? null,
      liveExpectedAmount,
      summary,
      collections: this.summarizeCollections(payments),
      movements: session.movements.map((movement) =>
        this.toMovementResponse(movement),
      ),
    };
  }

  private summarizeCollections(
    payments: SessionRecord['payments'],
  ): CashCollectionsResponse {
    const zero = new Prisma.Decimal(0);
    const methods = new Map<
      string,
      {
        method: SessionRecord['payments'][number]['paymentMethod'];
        amount: Prisma.Decimal;
        cancelled: Prisma.Decimal;
        refunded: Prisma.Decimal;
        count: number;
      }
    >();
    let cash = zero;
    let nonCash = zero;
    let cancelled = zero;
    let refunded = zero;
    for (const { paymentMethod, cashMovement, amount, status } of payments) {
      const entry = methods.get(paymentMethod.id) ?? {
        method: paymentMethod,
        amount: zero,
        cancelled: zero,
        refunded: zero,
        count: 0,
      };
      methods.set(paymentMethod.id, entry);
      if (status === PaymentStatus.COMPLETED) {
        entry.amount = entry.amount.add(amount);
        entry.count++;
        if (cashMovement) cash = cash.add(amount);
        else nonCash = nonCash.add(amount);
      } else if (status === PaymentStatus.CANCELLED) {
        entry.cancelled = entry.cancelled.add(amount);
        cancelled = cancelled.add(amount);
      } else if (status === PaymentStatus.REFUNDED) {
        entry.refunded = entry.refunded.add(amount);
        refunded = refunded.add(amount);
      }
    }
    return {
      total: cash.add(nonCash).toFixed(2),
      cash: cash.toFixed(2),
      nonCash: nonCash.toFixed(2),
      cancelled: cancelled.toFixed(2),
      refunded: refunded.toFixed(2),
      methods: [...methods.values()]
        .sort((a, b) => a.method.code.localeCompare(b.method.code))
        .map((entry) => ({
          ...entry.method,
          count: entry.count,
          amount: entry.amount.toFixed(2),
          cancelled: entry.cancelled.toFixed(2),
          refunded: entry.refunded.toFixed(2),
        })),
    };
  }

  private rethrowNameConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe una caja con ese nombre');
    }
  }
}
