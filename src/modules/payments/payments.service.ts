import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AuditAction,
  CashMovementType,
  CashSessionStatus,
  OrderStatus,
  PaymentMethodCode,
  PaymentStatus,
  TableStatus,
} from '@/generated/prisma/enums';
import { OperationsEventsService } from '@/modules/realtime/operations-events.service';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CancelPaymentDto,
  CreatePaymentDto,
  PaymentIdParamDto,
  PaymentOrderIdParamDto,
} from './dto/payment.dto';
import {
  OrderPaymentsResponse,
  PaymentResponse,
} from './interfaces/payment.interface';

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  amount: true,
  status: true,
  reference: true,
  notes: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  order: { select: { number: true, status: true } },
  paymentMethod: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, username: true } },
  cashMovement: {
    select: {
      id: true,
      cashSessionId: true,
      type: true,
      amount: true,
      description: true,
    },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRecord = Prisma.PaymentGetPayload<{
  select: typeof PAYMENT_SELECT;
}>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly operationsEvents: OperationsEventsService,
  ) {}

  async create(
    params: PaymentOrderIdParamDto,
    dto: CreatePaymentDto,
    user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    const paymentId = await this.db.$transaction(
      async (tx) => {
        const [order, method] = await Promise.all([
          tx.order.findUnique({
            where: { id: params.id },
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              tables: { select: { tableId: true } },
              payments: {
                where: { status: PaymentStatus.COMPLETED },
                select: { amount: true },
              },
            },
          }),
          tx.paymentMethod.findUnique({
            where: { id: dto.paymentMethodId },
            select: { id: true, code: true, name: true, active: true },
          }),
        ]);
        if (!order) throw new NotFoundException('Pedido no encontrado');
        if (!method)
          throw new NotFoundException('Metodo de pago no encontrado');
        if (!method.active) {
          throw new ConflictException('El metodo de pago esta inactivo');
        }
        if (
          order.status === OrderStatus.DRAFT ||
          order.status === OrderStatus.CANCELLED
        ) {
          throw new ConflictException(
            'El pedido no esta listo para recibir pagos',
          );
        }
        if (order.status === OrderStatus.PAID) {
          throw new ConflictException('El pedido ya esta pagado');
        }

        const amount = new Prisma.Decimal(dto.amount);
        const paid = order.payments.reduce(
          (total, payment) => total.add(payment.amount),
          new Prisma.Decimal(0),
        );
        const pending = order.total.sub(paid);
        if (amount.greaterThan(pending)) {
          throw new BadRequestException(
            `El monto excede el saldo pendiente de ${pending.toFixed(2)}`,
          );
        }

        if (method.code === PaymentMethodCode.CASH) {
          if (!dto.cashSessionId) {
            throw new BadRequestException(
              'Los pagos en efectivo requieren una sesion de caja',
            );
          }
          await this.ensureOpenCashSession(tx, dto.cashSessionId);
        } else if (dto.cashSessionId) {
          throw new BadRequestException(
            'cashSessionId solo corresponde a pagos en efectivo',
          );
        }

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            paymentMethodId: method.id,
            amount,
            reference: dto.reference,
            notes: dto.notes,
            userId: user.id,
          },
          select: { id: true },
        });

        if (method.code === PaymentMethodCode.CASH && dto.cashSessionId) {
          await tx.cashMovement.create({
            data: {
              cashSessionId: dto.cashSessionId,
              type: CashMovementType.SALE,
              amount,
              description: `Pago en efectivo del pedido #${order.number}`,
              paymentId: payment.id,
              userId: user.id,
            },
          });
        }

        if (paid.add(amount).equals(order.total)) {
          const now = new Date();
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PAID,
              paidAt: now,
              closedAt: now,
              closedById: user.id,
            },
          });
          const tableIds = order.tables.map(({ tableId }) => tableId);
          if (tableIds.length) {
            await tx.table.updateMany({
              where: { id: { in: tableIds }, active: true },
              data: { status: TableStatus.AVAILABLE },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.PAYMENT,
            entity: 'Payment',
            entityId: payment.id,
            description: `Pago ${method.name} de ${amount.toFixed(2)} para pedido #${order.number}`,
          },
        });
        return payment.id;
      },
      { isolationLevel: 'Serializable' },
    );

    const response = await this.findOne(paymentId);
    await this.emitOrderPaymentChanges(response);
    return response;
  }

  async findAll(
    params: PaymentOrderIdParamDto,
  ): Promise<OrderPaymentsResponse> {
    const order = await this.db.order.findUnique({
      where: { id: params.id },
      select: {
        total: true,
        payments: {
          select: PAYMENT_SELECT,
          orderBy: { paidAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const paid = order.payments
      .filter((payment) => payment.status === PaymentStatus.COMPLETED)
      .reduce(
        (total, payment) => total.add(payment.amount),
        new Prisma.Decimal(0),
      );
    return {
      items: order.payments.map((payment) => this.toResponse(payment)),
      summary: {
        orderTotal: order.total.toString(),
        paid: paid.toString(),
        pending: Prisma.Decimal.max(order.total.sub(paid), 0).toString(),
      },
    };
  }

  async cancel(
    params: PaymentIdParamDto,
    dto: CancelPaymentDto,
    user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    await this.db.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            amount: true,
            status: true,
            order: { select: { id: true, number: true, status: true } },
            cashMovement: { select: { id: true } },
          },
        });
        if (!payment) throw new NotFoundException('Pago no encontrado');
        if (payment.status !== PaymentStatus.COMPLETED) {
          throw new ConflictException('El pago ya no puede cancelarse');
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CANCELLED },
        });
        if (payment.cashMovement) {
          await tx.cashMovement.update({
            where: { id: payment.cashMovement.id },
            data: {
              type: CashMovementType.ADJUSTMENT,
              amount: new Prisma.Decimal(0),
              description: `Pago cancelado: ${dto.reason}`,
              userId: user.id,
            },
          });
        }
        if (payment.order.status === OrderStatus.PAID) {
          await tx.order.update({
            where: { id: payment.order.id },
            data: {
              status: OrderStatus.SERVED,
              paidAt: null,
              closedAt: null,
              closedById: null,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CANCEL,
            entity: 'Payment',
            entityId: payment.id,
            description: `Pago de ${payment.amount.toFixed(2)} cancelado en pedido #${payment.order.number}: ${dto.reason}`,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    const response = await this.findOne(params.id);
    await this.emitOrderPaymentChanges(response);
    return response;
  }

  private async findOne(id: string): Promise<PaymentResponse> {
    const payment = await this.db.payment.findUnique({
      where: { id },
      select: PAYMENT_SELECT,
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return this.toResponse(payment);
  }

  private async ensureOpenCashSession(
    tx: Prisma.TransactionClient,
    cashSessionId: string,
  ): Promise<void> {
    const session = await tx.cashRegisterSession.findUnique({
      where: { id: cashSessionId },
      select: {
        status: true,
        cashRegister: { select: { active: true } },
      },
    });
    if (!session) throw new NotFoundException('Sesion de caja no encontrada');
    if (
      session.status !== CashSessionStatus.OPEN ||
      !session.cashRegister.active
    ) {
      throw new ConflictException('La sesion de caja no esta abierta y activa');
    }
  }

  private async emitOrderPaymentChanges(
    payment: PaymentResponse,
  ): Promise<void> {
    this.operationsEvents.emitOrderStatusChanged({
      orderId: payment.orderId,
      orderNumber: payment.orderNumber,
      status: payment.orderStatus,
    });
    if (payment.orderStatus === OrderStatus.PAID) {
      await this.emitReleasedTables(payment.orderId);
    }
  }

  private async emitReleasedTables(orderId: string): Promise<void> {
    const tables = await this.db.orderTable.findMany({
      where: { orderId },
      select: { tableId: true },
    });
    for (const table of tables) {
      this.operationsEvents.emitTableStatusChanged({
        tableId: table.tableId,
        status: TableStatus.AVAILABLE,
        orderId,
      });
    }
  }

  private toResponse(payment: PaymentRecord): PaymentResponse {
    const { order, amount, cashMovement, ...data } = payment;
    return {
      ...data,
      orderId: payment.orderId,
      orderNumber: order.number,
      orderStatus: order.status,
      amount: amount.toString(),
      cashMovement: cashMovement
        ? { ...cashMovement, amount: cashMovement.amount.toString() }
        : null,
    };
  }
}
