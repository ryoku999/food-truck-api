import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateBillPartDto } from './dto/payment.dto';

const BILL_SELECT = {
  id: true,
  total: true,
  status: true,
  items: {
    where: { status: { not: 'CANCELLED' } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      quantity: true,
      subtotal: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
    },
  },
  billParts: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      total: true,
      items: { select: { orderItemId: true, quantity: true, amount: true } },
      payments: { select: { amount: true, status: true } },
    },
  },
  payments: {
    where: { status: 'COMPLETED', billPartId: null },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.OrderSelect;
type Bill = Prisma.OrderGetPayload<{ select: typeof BILL_SELECT }>;
const zero = new Prisma.Decimal(0);

@Injectable()
export class BillPartsService {
  constructor(private readonly db: DatabaseService) {}

  async list(orderId: string) {
    return this.response(await this.find(this.db, orderId));
  }

  async create(orderId: string, dto: CreateBillPartDto, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        await this.createInTransaction(tx, orderId, dto, userId);
        return this.response(await this.find(tx, orderId));
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async createInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    dto: CreateBillPartDto,
    userId: string,
  ) {
    const order = await this.find(tx, orderId);
    this.ensureEditable(order);
    if (order.payments.length)
      throw new ConflictException(
        'Anula los abonos por monto antes de dividir por productos',
      );
    if (!this.canAllocate(order)) {
      throw new BadRequestException(
        'Este pedido tiene líneas con importes o cantidades incompatibles con la división',
      );
    }
    const remaining = this.remaining(order);
    const items = dto.items.map(({ orderItemId, quantity }) => {
      const line = remaining.find((item) => item.id === orderItemId);
      if (!line || quantity > line.remainingQuantity)
        throw new ConflictException(
          'La cantidad supera las unidades sin asignar',
        );
      return {
        orderItemId,
        quantity,
        amount: line.remainingAmount
          .mul(quantity)
          .div(line.remainingQuantity)
          .toDecimalPlaces(2),
      };
    });
    await tx.order.update({
      where: { id: orderId },
      data: { updatedAt: new Date() },
    });
    const part = await tx.billPart.create({
      data: {
        orderId,
        name: dto.name?.trim() || `Parte ${order.billParts.length + 1}`,
        total: items.reduce((sum, item) => sum.add(item.amount), zero),
        items: { createMany: { data: items } },
      },
      select: { id: true, total: true },
    });
    await tx.auditLog.create({
      data: {
        action: 'CREATE',
        entity: 'BillPart',
        entityId: part.id,
        userId,
        description: 'Parte de cuenta por productos',
      },
    });
    return part;
  }

  async remove(orderId: string, partId: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        const order = await this.find(tx, orderId);
        this.ensureEditable(order);
        const part = order.billParts.find((item) => item.id === partId);
        if (!part) throw new NotFoundException('Parte no encontrada');
        if (part.payments.some((payment) => payment.status !== 'CANCELLED')) {
          throw new ConflictException(
            'Anula los pagos antes de liberar la parte',
          );
        }
        await tx.order.update({
          where: { id: orderId },
          data: { updatedAt: new Date() },
        });
        // Keep cancelled payments in order history when their unused allocation is released.
        await tx.payment.updateMany({
          where: { billPartId: partId },
          data: { billPartId: null },
        });
        await tx.printJob.updateMany({
          where: {
            documentKey: { startsWith: `part:${partId}:` },
            status: { in: ['PENDING', 'FAILED'] },
          },
          data: { status: 'CANCELLED', error: 'Parte liberada' },
        });
        await tx.billPart.delete({ where: { id: partId } });
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entity: 'BillPart',
            entityId: partId,
            userId,
            description: 'Asignación de productos liberada',
          },
        });
        return this.response(await this.find(tx, orderId));
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async find(db: Prisma.TransactionClient, id: string) {
    const order = await db.order.findUnique({
      where: { id },
      select: BILL_SELECT,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private ensureEditable(order: Bill) {
    if (
      order.status === 'DRAFT' ||
      order.status === 'CANCELLED' ||
      order.status === 'PAID'
    ) {
      throw new ConflictException('El pedido no admite cambios en sus partes');
    }
  }

  private remaining(order: Bill) {
    const subtotal = order.items.reduce(
      (sum, item) => sum.add(item.subtotal),
      zero,
    );
    let gross = zero;
    let allocated = zero;
    return order.items.map((item) => {
      gross = gross.add(item.subtotal);
      const cumulative = subtotal.isZero()
        ? zero
        : order.total.mul(gross).div(subtotal).toDecimalPlaces(2);
      let remainingAmount = cumulative.sub(allocated);
      let remainingQuantity = item.quantity;
      allocated = cumulative;
      for (const part of order.billParts) {
        const line = part.items.find((line) => line.orderItemId === item.id);
        if (!line) continue;
        remainingAmount = remainingAmount.sub(line.amount);
        remainingQuantity -= line.quantity;
      }
      return {
        id: item.id,
        name: item.productNameSnapshot,
        variant: item.variantNameSnapshot,
        remainingQuantity,
        remainingAmount,
      };
    });
  }

  private response(order: Bill) {
    if (!this.canAllocate(order)) {
      return {
        canSplit: false,
        unassignedAmount: order.total.toFixed(2),
        available: [],
        parts: [],
      };
    }
    const remaining = this.remaining(order);
    return {
      canSplit:
        !order.payments.length &&
        !['DRAFT', 'PAID', 'CANCELLED'].includes(order.status),
      unassignedAmount: remaining
        .reduce((sum, item) => sum.add(item.remainingAmount), zero)
        .toFixed(2),
      available: remaining
        .filter((item) => item.remainingQuantity > 0)
        .map((item) => ({
          ...item,
          remainingAmount: item.remainingAmount.toFixed(2),
        })),
      parts: order.billParts.map((part) => {
        const paid = part.payments
          .filter((payment) => payment.status === 'COMPLETED')
          .reduce((sum, payment) => sum.add(payment.amount), zero);
        return {
          id: part.id,
          name: part.name,
          total: part.total.toFixed(2),
          paid: paid.toFixed(2),
          pending: part.total.sub(paid).toFixed(2),
          removable: part.payments.every(
            (payment) => payment.status === 'CANCELLED',
          ),
          items: part.items.map((item) => {
            const line = remaining.find((line) => line.id === item.orderItemId);
            return {
              ...item,
              name: line?.name ?? 'Producto',
              variant: line?.variant ?? null,
              amount: item.amount.toFixed(2),
            };
          }),
        };
      }),
    };
  }

  private canAllocate(order: Bill) {
    return order.items.every(
      (item) => item.quantity > 0 && !item.subtotal.lessThan(0),
    );
  }
}
