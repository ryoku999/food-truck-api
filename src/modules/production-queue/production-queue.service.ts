import { DatabaseService } from '@/database/database.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AuditAction,
  OrderItemStatus,
  OrderStatus,
  ProductionAreaCode,
  TableStatus,
} from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { OperationsEventsService } from '@/modules/realtime/operations-events.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductionItemIdParamDto,
  ProductionQueueQueryDto,
  UpdatePreparationStatusDto,
} from './dto/production-queue.dto';
import {
  PaginatedProductionQueueResponse,
  ProductionQueueItemResponse,
} from './interfaces/production-queue.interface';

const ACTIVE_QUEUE_STATUSES: OrderItemStatus[] = [
  OrderItemStatus.PENDING,
  OrderItemStatus.PREPARING,
  OrderItemStatus.READY,
];

const QUEUE_ITEM_SELECT = {
  id: true,
  orderId: true,
  quantity: true,
  productNameSnapshot: true,
  variantNameSnapshot: true,
  notes: true,
  status: true,
  productionArea: true,
  sentAt: true,
  preparingAt: true,
  readyAt: true,
  servedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      number: true,
      status: true,
      tables: {
        select: {
          table: {
            select: {
              id: true,
              number: true,
              name: true,
              diningArea: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  modifiers: {
    select: {
      groupNameSnapshot: true,
      optionNameSnapshot: true,
      quantity: true,
    },
  },
  comboSelections: {
    select: { groupNameSnapshot: true, productNameSnapshot: true },
  },
} satisfies Prisma.OrderItemSelect;

type QueueItemRecord = Prisma.OrderItemGetPayload<{
  select: typeof QUEUE_ITEM_SELECT;
}>;

const ALLOWED_TRANSITIONS: Record<OrderItemStatus, OrderItemStatus[]> = {
  [OrderItemStatus.DRAFT]: [],
  [OrderItemStatus.PENDING]: [
    OrderItemStatus.PREPARING,
    OrderItemStatus.CANCELLED,
  ],
  [OrderItemStatus.PREPARING]: [
    OrderItemStatus.READY,
    OrderItemStatus.CANCELLED,
  ],
  [OrderItemStatus.READY]: [OrderItemStatus.SERVED],
  [OrderItemStatus.SERVED]: [],
  [OrderItemStatus.CANCELLED]: [],
};

@Injectable()
export class ProductionQueueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly operationsEvents: OperationsEventsService,
  ) {}

  async findQueue(
    area: ProductionAreaCode,
    query: ProductionQueueQueryDto,
  ): Promise<PaginatedProductionQueueResponse> {
    const where: Prisma.OrderItemWhereInput = {
      productionArea: area,
      status: query.status ?? { in: ACTIVE_QUEUE_STATUSES },
      orderId: query.orderId,
      ...(query.search
        ? {
            OR: [
              {
                productNameSnapshot: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                variantNameSnapshot: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            sentAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.orderItem.findMany({
        where,
        select: QUEUE_ITEM_SELECT,
        orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.orderItem.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toResponse(item)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  async updateStatus(
    area: ProductionAreaCode,
    params: ProductionItemIdParamDto,
    dto: UpdatePreparationStatusDto,
    user: AuthenticatedUser,
  ): Promise<ProductionQueueItemResponse> {
    await this.db.$transaction(
      async (tx) => {
        const item = await tx.orderItem.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            orderId: true,
            status: true,
            productionArea: true,
            productNameSnapshot: true,
            order: { select: { status: true } },
          },
        });
        if (!item)
          throw new NotFoundException('Item de produccion no encontrado');
        if (item.productionArea !== area) {
          throw new NotFoundException('Item de produccion no encontrado');
        }
        if (
          item.order.status === OrderStatus.CANCELLED ||
          item.order.status === OrderStatus.PAID
        ) {
          throw new ConflictException('El pedido ya esta cerrado');
        }
        if (!ALLOWED_TRANSITIONS[item.status].includes(dto.status)) {
          throw new ConflictException(
            `No se puede cambiar un item de ${item.status} a ${dto.status}`,
          );
        }
        if (
          dto.status === OrderItemStatus.CANCELLED &&
          !dto.cancellationReason?.trim()
        ) {
          throw new BadRequestException(
            'El motivo de cancelacion es obligatorio',
          );
        }
        const now = new Date();
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            status: dto.status,
            ...(dto.status === OrderItemStatus.PREPARING
              ? { preparingAt: now }
              : {}),
            ...(dto.status === OrderItemStatus.READY ? { readyAt: now } : {}),
            ...(dto.status === OrderItemStatus.SERVED ? { servedAt: now } : {}),
            ...(dto.status === OrderItemStatus.CANCELLED
              ? {
                  cancelledAt: now,
                  cancelledById: user.id,
                  cancellationReason: dto.cancellationReason?.trim(),
                }
              : {}),
          },
        });
        if (dto.status === OrderItemStatus.CANCELLED) {
          await this.recalculateTotals(tx, item.orderId);
        }
        await this.synchronizeOrder(tx, item.orderId, user.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action:
              dto.status === OrderItemStatus.CANCELLED
                ? AuditAction.CANCEL
                : AuditAction.UPDATE,
            entity: 'OrderItem',
            entityId: item.id,
            description: `${item.productNameSnapshot}: ${item.status} -> ${dto.status}`,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    const response = await this.findOne(area, params.id);
    this.operationsEvents.emitOrderItemStatusChanged(
      response,
      area === ProductionAreaCode.KITCHEN ? 'KITCHEN' : 'BAR',
    );
    this.operationsEvents.emitOrderStatusChanged({
      orderId: response.orderId,
      status: response.orderStatus,
    });
    if (response.orderStatus === OrderStatus.CANCELLED) {
      for (const table of response.tables) {
        this.operationsEvents.emitTableStatusChanged({
          tableId: table.id,
          status: TableStatus.AVAILABLE,
          orderId: response.orderId,
        });
      }
    }
    return response;
  }

  private async findOne(
    area: ProductionAreaCode,
    id: string,
  ): Promise<ProductionQueueItemResponse> {
    const item = await this.db.orderItem.findFirst({
      where: { id, productionArea: area },
      select: QUEUE_ITEM_SELECT,
    });
    if (!item) throw new NotFoundException('Item de produccion no encontrado');
    return this.toResponse(item);
  }

  private async synchronizeOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        tables: { select: { tableId: true } },
        items: { select: { status: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const activeItems = order.items.filter(
      (item) => item.status !== OrderItemStatus.CANCELLED,
    );
    if (activeItems.length === 0) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          closedAt: new Date(),
          closedById: userId,
        },
      });
      const tableIds = order.tables.map(({ tableId }) => tableId);
      if (tableIds.length) {
        await tx.table.updateMany({
          where: { id: { in: tableIds }, active: true },
          data: { status: TableStatus.AVAILABLE },
        });
      }
      return;
    }
    let status: OrderStatus;
    if (activeItems.every((item) => item.status === OrderItemStatus.SERVED)) {
      status = OrderStatus.SERVED;
    } else if (
      activeItems.every((item) =>
        (
          [OrderItemStatus.READY, OrderItemStatus.SERVED] as OrderItemStatus[]
        ).includes(item.status),
      )
    ) {
      status = OrderStatus.READY;
    } else if (
      activeItems.some((item) =>
        (
          [
            OrderItemStatus.PREPARING,
            OrderItemStatus.READY,
            OrderItemStatus.SERVED,
          ] as OrderItemStatus[]
        ).includes(item.status),
      )
    ) {
      status = OrderStatus.IN_PROGRESS;
    } else {
      status = OrderStatus.SENT;
    }
    if (status !== order.status) {
      await tx.order.update({ where: { id: orderId }, data: { status } });
    }
  }

  private async recalculateTotals(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const [sum, order] = await Promise.all([
      tx.orderItem.aggregate({
        where: { orderId, status: { not: OrderItemStatus.CANCELLED } },
        _sum: { subtotal: true },
      }),
      tx.order.findUnique({
        where: { id: orderId },
        select: { discount: true },
      }),
    ]);
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const subtotal = sum._sum.subtotal ?? new Prisma.Decimal(0);
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        total: Prisma.Decimal.max(subtotal.sub(order.discount), 0),
      },
    });
  }

  private toResponse(item: QueueItemRecord): ProductionQueueItemResponse {
    const {
      order,
      modifiers,
      comboSelections,
      productNameSnapshot,
      variantNameSnapshot,
      ...data
    } = item;
    const startedAt = item.sentAt ?? item.createdAt;
    return {
      ...data,
      orderNumber: order.number,
      orderStatus: order.status,
      tables: order.tables.map(({ table }) => ({
        id: table.id,
        number: table.number,
        name: table.name,
        diningAreaName: table.diningArea.name,
      })),
      modifiers: modifiers.map((modifier) => ({
        groupName: modifier.groupNameSnapshot,
        optionName: modifier.optionNameSnapshot,
        quantity: modifier.quantity,
      })),
      comboSelections: comboSelections.map((selection) => ({
        groupName: selection.groupNameSnapshot,
        productName: selection.productNameSnapshot,
      })),
      productName: productNameSnapshot,
      variantName: variantNameSnapshot,
      elapsedSeconds: Math.max(
        0,
        Math.floor((Date.now() - startedAt.getTime()) / 1000),
      ),
    };
  }
}
