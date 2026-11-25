/// <reference types="jest" />

import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DatabaseService } from '@/database/database.service';
import { OrderStatus, TableStatus, UserRole } from '@/generated/prisma/enums';
import type { OperationsEventsService } from '@/modules/realtime/operations-events.service';
import type { PrinterWorkerEventsService } from '@/modules/realtime/printer-worker-events.service';
import type { OrderDetailResponse } from './interfaces/order.interface';
import { OrdersService } from './orders.service';

jest.mock('@/database/database.service', () => ({ DatabaseService: class {} }));
jest.mock('@/generated/prisma/client', () => ({ Prisma: {} }));
jest.mock('@/modules/realtime/operations-events.service', () => ({
  OperationsEventsService: class {},
}));
jest.mock('@/modules/realtime/printer-worker-events.service', () => ({
  PrinterWorkerEventsService: class {},
}));

describe('OrdersService.cancel', () => {
  const params = { id: 'order-id' };
  const dto = { reason: 'El cliente se retiró antes de pedir.' };
  const waiter = { id: 'waiter-id', userRole: UserRole.WAITER };

  function setup(status: OrderStatus, createdById = waiter.id) {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          number: 1,
          status,
          createdById,
          tables: [{ tableId: 'table-id' }],
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      orderItem: { updateMany: jest.fn() },
      table: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const db = {
      $transaction: (operation: (transaction: typeof tx) => Promise<void>) =>
        operation(tx),
    };
    const events = {
      emitOrderStatusChanged: jest.fn(),
      emitTableStatusChanged: jest.fn(),
    };
    const service = new OrdersService(
      db as unknown as DatabaseService,
      events as unknown as OperationsEventsService,
      {} as PrinterWorkerEventsService,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: params.id,
      status: OrderStatus.CANCELLED,
      items: [],
      tables: [{ id: 'table-id' }],
    } as unknown as OrderDetailResponse);
    return { service, tx, events };
  }

  it('cancels the waiter’s own draft and releases its table', async () => {
    const { service, tx, events } = setup(OrderStatus.DRAFT);

    await service.cancel(params, dto, waiter);

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: params.id },
      data: {
        status: OrderStatus.CANCELLED,
        closedAt: expect.any(Date),
        closedById: waiter.id,
      },
    });
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: params.id, status: { not: 'CANCELLED' } },
      data: {
        status: 'CANCELLED',
        cancelledAt: expect.any(Date),
        cancelledById: waiter.id,
        cancellationReason: dto.reason,
      },
    });
    expect(tx.table.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['table-id'] }, active: true },
      data: { status: TableStatus.AVAILABLE },
    });
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({
      tableId: 'table-id',
      status: TableStatus.AVAILABLE,
      orderId: params.id,
    });
  });

  it('rejects cancellation of another waiter’s draft', async () => {
    const { service, tx } = setup(OrderStatus.DRAFT, 'other-waiter-id');

    await expect(service.cancel(params, dto, waiter)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.table.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancellation by the waiter after the order is sent', async () => {
    const { service, tx } = setup(OrderStatus.SENT);

    await expect(service.cancel(params, dto, waiter)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.table.updateMany).not.toHaveBeenCalled();
  });

  it('allows the cashier to cancel a sent order', async () => {
    const { service } = setup(OrderStatus.SENT);

    await expect(
      service.cancel(params, dto, {
        id: 'cashier-id',
        userRole: UserRole.CASHIER,
      }),
    ).resolves.toMatchObject({ status: OrderStatus.CANCELLED });
  });
});
