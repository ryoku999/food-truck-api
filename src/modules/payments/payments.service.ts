import { DatabaseService } from '@/database/database.service';
import { BillPartsService } from './bill-parts.service';
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
  cashSessionId: true,
  billPartId: true,
  pendingAfter: true,
  orderId: true,
  amount: true,
  receivedAmount: true,
  changeAmount: true,
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
    private readonly billParts: BillPartsService,
  ) {}

  async create(
    params: PaymentOrderIdParamDto,
    dto: CreatePaymentDto,
    user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    const paymentId = await this.db.$transaction(
      async (tx) => {
        const row = await tx.order.findUnique({
          where: { id: params.id },
          select: { id: true, number: true, status: true, total: true },
        });
        if (!row) throw new NotFoundException('Pedido no encontrado');
        const method = await tx.paymentMethod.findUnique({
          where: { id: dto.paymentMethodId },
          select: { id: true, code: true, name: true, active: true },
        });
        if (!method)
          throw new NotFoundException('Metodo de pago no encontrado');
        if (!method.active) {
          throw new ConflictException('El metodo de pago esta inactivo');
        }
        if (
          row.status === OrderStatus.DRAFT ||
          row.status === OrderStatus.CANCELLED
        ) {
          throw new ConflictException(
            'El pedido no esta listo para recibir pagos',
          );
        }
        if (row.status === OrderStatus.PAID) {
          throw new ConflictException('El pedido ya esta pagado');
        }

        const tables = await tx.orderTable.findMany({
          where: { orderId: row.id },
          select: { tableId: true },
        });
        const billParts = await tx.billPart.findMany({
          where: { orderId: row.id },
          select: { id: true, total: true },
        });
        const payments = await tx.payment.findMany({
          where: { orderId: row.id, status: PaymentStatus.COMPLETED },
          select: { amount: true, billPartId: true },
        });
        const order = { ...row, tables, billParts, payments };

        const amount = new Prisma.Decimal(dto.amount);
        const cash = method.code === PaymentMethodCode.CASH;
        const receivedAmount =
          dto.receivedAmount == null
            ? null
            : new Prisma.Decimal(dto.receivedAmount);
        if (cash && (!receivedAmount || receivedAmount.lessThan(amount))) {
          throw new BadRequestException(
            'El efectivo recibido debe ser mayor o igual al monto aplicado',
          );
        }
        if (!cash && receivedAmount !== null) {
          throw new BadRequestException(
            'El efectivo recibido solo corresponde a pagos en efectivo',
          );
        }
        const changeAmount = receivedAmount?.sub(amount) ?? null;
        const paid = order.payments.reduce(
          (total, payment) => total.add(payment.amount),
          new Prisma.Decimal(0),
        );
        const pending = order.total.sub(paid);
        if (dto.billPartId && dto.productSelection) {
          throw new BadRequestException(
            'Elige una parte existente o una selección nueva',
          );
        }
        if (
          order.billParts.length &&
          !dto.billPartId &&
          !dto.productSelection
        ) {
          throw new ConflictException(
            'Selecciona una parte para cobrar este pedido',
          );
        }
        if (dto.billPartId) {
          const part = order.billParts.find(
            (item) => item.id === dto.billPartId,
          );
          if (!part)
            throw new NotFoundException('Parte no encontrada en este pedido');
          const partPaid = order.payments
            .filter((item) => item.billPartId === part.id)
            .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
          if (amount.greaterThan(part.total.sub(partPaid))) {
            throw new BadRequestException(
              'El monto supera el saldo de la parte',
            );
          }
        }
        if (amount.greaterThan(pending)) {
          throw new BadRequestException(
            `El monto excede el saldo pendiente de ${pending.toFixed(2)}`,
          );
        }

        await this.lockOpenCashSession(tx, dto.cashSessionId);
        let billPartId = dto.billPartId;
        if (dto.productSelection) {
          const part = await this.billParts.createInTransaction(
            tx,
            order.id,
            dto.productSelection,
            user.id,
          );
          if (!part.total.equals(dto.productSelection.expectedTotal)) {
            throw new ConflictException(
              'Cambió el total de la selección. Actualiza la cuenta y revisa el importe',
            );
          }
          if (amount.greaterThan(part.total)) {
            throw new BadRequestException(
              'El monto supera el total de la selección',
            );
          }
          billPartId = part.id;
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: { updatedAt: new Date() },
          });
        }

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            paymentMethodId: method.id,
            cashSessionId: dto.cashSessionId,
            billPartId,
            pendingAfter: pending.sub(amount),
            amount,
            receivedAmount,
            changeAmount,
            reference: dto.reference,
            notes: dto.notes,
            userId: user.id,
          },
          select: { id: true },
        });

        if (cash) {
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
            cashSessionId: true,
            billPartId: true,
            order: { select: { id: true, number: true, status: true } },
            cashMovement: { select: { id: true } },
          },
        });
        if (!payment) throw new NotFoundException('Pago no encontrado');
        if (payment.status !== PaymentStatus.COMPLETED) {
          throw new ConflictException('El pago ya no puede cancelarse');
        }
        if (payment.cashSessionId) {
          await this.lockOpenCashSession(tx, payment.cashSessionId);
        }
        await tx.order.update({
          where: { id: payment.order.id },
          data: { updatedAt: new Date() },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CANCELLED },
        });
        await tx.printJob.updateMany({
          where: {
            orderId: payment.order.id,
            status: { in: ['PENDING', 'FAILED'] },
            OR: [
              { type: 'CUSTOMER_TICKET' },
              { documentKey: `payment:${payment.id}` },
              ...(payment.billPartId
                ? [
                    {
                      documentKey: {
                        startsWith: `part:${payment.billPartId}:`,
                      },
                    },
                  ]
                : []),
            ],
          },
          data: { status: 'CANCELLED', error: 'Pago anulado' },
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
          const tables = await tx.orderTable.findMany({
            where: { orderId: payment.order.id },
            select: {
              tableId: true,
              table: { select: { active: true, status: true } },
            },
          });
          const tableIds = tables.map((table) => table.tableId);
          if (
            tables.some(
              ({ table }) =>
                !table.active || table.status === TableStatus.DISABLED,
            ) ||
            (tableIds.length &&
              (await tx.orderTable.count({
                where: {
                  tableId: { in: tableIds },
                  orderId: { not: payment.order.id },
                  order: {
                    status: {
                      notIn: [OrderStatus.PAID, OrderStatus.CANCELLED],
                    },
                  },
                },
              })))
          ) {
            throw new ConflictException(
              'No se puede reabrir el pedido: una mesa ya no está disponible',
            );
          }
          await tx.order.update({
            where: { id: payment.order.id },
            data: {
              status: OrderStatus.SERVED,
              paidAt: null,
              closedAt: null,
              closedById: null,
            },
          });
          if (tableIds.length)
            await tx.table.updateMany({
              where: { id: { in: tableIds } },
              data: { status: TableStatus.OCCUPIED },
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

  private async lockOpenCashSession(
    tx: Prisma.TransactionClient,
    cashSessionId: string,
  ): Promise<void> {
    // Serialize payments and cancellations with the update that closes the turn.
    const updated = await tx.cashRegisterSession.updateMany({
      where: {
        id: cashSessionId,
        status: CashSessionStatus.OPEN,
        cashRegister: { active: true },
      },
      data: { updatedAt: new Date() },
    });
    if (updated.count) return;
    const session = await tx.cashRegisterSession.findUnique({
      where: { id: cashSessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Sesion de caja no encontrada');
    throw new ConflictException('La sesion de caja no esta abierta y activa');
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
    const {
      order,
      amount,
      receivedAmount,
      changeAmount,
      pendingAfter,
      cashMovement,
      ...data
    } = payment;
    return {
      ...data,
      orderId: payment.orderId,
      orderNumber: order.number,
      orderStatus: order.status,
      amount: amount.toString(),
      receivedAmount: receivedAmount?.toFixed(2) ?? null,
      changeAmount: changeAmount?.toFixed(2) ?? null,
      pendingAfter: pendingAfter?.toFixed(2) ?? null,
      cashMovement: cashMovement
        ? { ...cashMovement, amount: cashMovement.amount.toString() }
        : null,
    };
  }
}
