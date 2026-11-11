import { orderRoundNumbers } from '@/shared/utils/order-rounds';
import { DatabaseService } from '@/database/database.service';
import { ensureOrderUnbilled } from '@/modules/payments/ensure-order-unbilled';
import { Prisma } from '@/generated/prisma/client';
import {
  AuditAction,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PrinterPurpose,
  PrinterStatus,
  PrintJobType,
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
  AddOrderItemDto,
  CancelOrderItemDto,
  UpdateDraftOrderItemDto,
} from './dto/order-item.dto';
import { OrderIdParamDto, OrderItemParamDto } from './dto/order-params.dto';
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderQueryDto,
  SendOrderDto,
  SetOrderTablesDto,
  UpdateDraftOrderDto,
} from './dto/order.dto';
import {
  OrderDetailResponse,
  OrderSummaryResponse,
  PaginatedOrdersResponse,
} from './interfaces/order.interface';

const OPEN_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SENT,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const ORDER_SELECT = {
  id: true,
  number: true,
  type: true,
  status: true,
  customerName: true,
  customerPhone: true,
  notes: true,
  subtotal: true,
  discount: true,
  total: true,
  openedAt: true,
  sentAt: true,
  closedAt: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, username: true } },
  closedBy: { select: { id: true, username: true } },
  tables: {
    select: {
      joinedAt: true,
      table: {
        select: {
          id: true,
          number: true,
          name: true,
          diningArea: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  },
  items: {
    select: {
      id: true,
      productId: true,
      productVariantId: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      quantity: true,
      unitPrice: true,
      modifiersPrice: true,
      subtotal: true,
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
      createdBy: { select: { id: true, username: true } },
      cancelledBy: { select: { id: true, username: true } },
      modifiers: {
        select: {
          id: true,
          modifierOptionId: true,
          groupNameSnapshot: true,
          optionNameSnapshot: true,
          priceDelta: true,
          quantity: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      comboSelections: {
        select: {
          id: true,
          comboGroupItemId: true,
          groupNameSnapshot: true,
          productNameSnapshot: true,
          additionalPrice: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

type OrderRecord = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly operationsEvents: OperationsEventsService,
  ) {}

  async create(
    dto: CreateOrderDto,
    user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    const type = dto.type ?? OrderType.DINE_IN;
    this.validateTablesForType(type, dto.tableIds ?? []);
    const orderId = await this.db.$transaction(
      async (tx) => {
        await this.validateTables(tx, dto.tableIds ?? []);
        const last = await tx.order.aggregate({ _max: { number: true } });
        const order = await tx.order.create({
          data: {
            number: (last._max.number ?? 0) + 1,
            type,
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            notes: dto.notes,
            createdById: user.id,
            tables: dto.tableIds?.length
              ? {
                  create: dto.tableIds.map((tableId) => ({ tableId })),
                }
              : undefined,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CREATE,
            entity: 'Order',
            entityId: order.id,
            description: `Pedido ${order.id} creado`,
          },
        });
        return order.id;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne({ id: orderId });
  }

  async findAll(query: OrderQueryDto): Promise<PaginatedOrdersResponse> {
    const numericSearch = query.search ? Number(query.search) : Number.NaN;
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      ...(query.view && {
        AND: {
          status:
            query.view === 'active'
              ? { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] }
              : { in: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      }),
      type: query.type,
      createdById: query.createdById,
      ...(query.tableId
        ? { tables: { some: { tableId: query.tableId } } }
        : {}),
      ...(query.from || query.to
        ? {
            openedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search, mode: 'insensitive' } },
              { customerPhone: { contains: query.search } },
              ...(Number.isInteger(numericSearch)
                ? [{ number: numericSearch }]
                : []),
            ],
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      this.db.order.findMany({
        where,
        select: ORDER_SELECT,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.order.count({ where }),
    ]);
    return {
      items: records.map((record) => this.toResponse(record)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(params: OrderIdParamDto): Promise<OrderDetailResponse> {
    const order = await this.db.order.findUnique({
      where: { id: params.id },
      select: ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return this.toResponse(order);
  }

  async update(
    params: OrderIdParamDto,
    dto: UpdateDraftOrderDto,
  ): Promise<OrderDetailResponse> {
    this.ensureBody(dto);
    const order = await this.getOrderState(params.id);
    this.ensureDraft(order.status);
    const type = dto.type ?? order.type;
    const tableCount = await this.db.orderTable.count({
      where: { orderId: params.id },
    });
    this.validateTablesForType(
      type,
      Array.from({ length: tableCount }, () => 'x'),
    );
    await this.db.order.update({ where: { id: params.id }, data: dto });
    return this.findOne(params);
  }

  async setTables(
    params: OrderIdParamDto,
    dto: SetOrderTablesDto,
  ): Promise<OrderDetailResponse> {
    await this.db.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.id },
          select: { type: true, status: true },
        });
        if (!order) throw new NotFoundException('Pedido no encontrado');
        this.ensureDraft(order.status);
        this.validateTablesForType(order.type, dto.tableIds);
        await this.validateTables(tx, dto.tableIds, params.id);
        await tx.orderTable.deleteMany({ where: { orderId: params.id } });
        if (dto.tableIds.length) {
          await tx.orderTable.createMany({
            data: dto.tableIds.map((tableId) => ({
              orderId: params.id,
              tableId,
            })),
          });
        }
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne(params);
  }

  async addItem(
    params: OrderIdParamDto,
    dto: AddOrderItemDto,
    user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    await this.db.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.id },
          select: { status: true },
        });
        if (!order) throw new NotFoundException('Pedido no encontrado');
        this.ensureOpenOrder(order.status);

        const itemData = await this.buildItemData(tx, dto, user.id);
        await tx.orderItem.create({
          data: { orderId: params.id, ...itemData },
        });
        await this.recalculateTotals(tx, params.id);
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne(params);
  }

  async updateItem(
    params: OrderItemParamDto,
    dto: UpdateDraftOrderItemDto,
  ): Promise<OrderDetailResponse> {
    this.ensureBody(dto);
    await this.db.$transaction(
      async (tx) => {
        const item = await tx.orderItem.findFirst({
          where: { id: params.itemId, orderId: params.id },
        });
        if (!item) throw new NotFoundException('Item de pedido no encontrado');
        const order = await tx.order.findUniqueOrThrow({
          where: { id: params.id },
          select: { status: true },
        });
        this.ensureOpenOrder(order.status);
        this.ensureDraft(item.status);

        const quantity = dto.quantity ?? item.quantity;
        const changesConfiguration =
          dto.productVariantId !== undefined ||
          dto.modifierOptionIds !== undefined ||
          dto.comboSelections !== undefined;
        if (changesConfiguration) {
          if (!item.productId)
            throw new ConflictException('El producto ya no existe');
          const modifiers = await tx.orderItemModifier.findMany({
            where: { orderItemId: item.id },
          });
          const combos = await tx.orderItemComboSelection.findMany({
            where: { orderItemId: item.id },
          });
          const comboItems = await tx.comboGroupItem.findMany({
            where: {
              id: { in: combos.flatMap((row) => row.comboGroupItemId ?? []) },
            },
            select: { id: true, comboGroupId: true },
          });
          const selections = new Map<string, string[]>();
          for (const combo of comboItems) {
            selections.set(combo.comboGroupId, [
              ...(selections.get(combo.comboGroupId) ?? []),
              combo.id,
            ]);
          }
          const data = await this.buildItemData(
            tx,
            {
              productId: item.productId,
              productVariantId:
                dto.productVariantId === undefined
                  ? (item.productVariantId ?? undefined)
                  : (dto.productVariantId ?? undefined),
              quantity,
              notes:
                dto.notes === undefined
                  ? (item.notes ?? undefined)
                  : (dto.notes ?? undefined),
              modifierOptionIds:
                dto.modifierOptionIds ??
                modifiers.flatMap((row) => row.modifierOptionId ?? []),
              comboSelections:
                dto.comboSelections ??
                [...selections].map(([comboGroupId, comboGroupItemIds]) => ({
                  comboGroupId,
                  comboGroupItemIds,
                })),
            },
            item.createdById,
          );
          await tx.orderItemModifier.deleteMany({
            where: { orderItemId: item.id },
          });
          await tx.orderItemComboSelection.deleteMany({
            where: { orderItemId: item.id },
          });
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              ...data,
              productVariantId: data.productVariantId ?? null,
              variantNameSnapshot: data.variantNameSnapshot ?? null,
              notes: dto.notes === undefined ? item.notes : dto.notes,
            },
          });
        } else {
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              quantity,
              notes: dto.notes,
              subtotal: item.unitPrice.add(item.modifiersPrice).mul(quantity),
            },
          });
        }
        await this.recalculateTotals(tx, params.id);
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne({ id: params.id });
  }

  async removeItem(params: OrderItemParamDto): Promise<OrderDetailResponse> {
    await this.db.$transaction(
      async (tx) => {
        const item = await tx.orderItem.findFirst({
          where: { id: params.itemId, orderId: params.id },
          select: {
            id: true,
            status: true,
            order: { select: { status: true } },
          },
        });
        if (!item) throw new NotFoundException('Item de pedido no encontrado');
        this.ensureOpenOrder(item.order.status);
        this.ensureDraft(item.status);

        await tx.orderItem.delete({ where: { id: item.id } });
        await this.recalculateTotals(tx, params.id);
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne({ id: params.id });
  }

  async send(
    params: OrderIdParamDto,
    dto: SendOrderDto,
    user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    const sentIds = await this.db.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            number: true,
            type: true,
            status: true,
            notes: true,
            sentAt: true,
            tables: { select: { tableId: true } },
            items: {
              where: { status: OrderItemStatus.DRAFT },
              select: {
                id: true,
                productId: true,
                productVariantId: true,
                productNameSnapshot: true,
                quantity: true,
                notes: true,
                productionArea: true,
                modifiers: { select: { modifierOptionId: true } },
                comboSelections: { select: { comboGroupItemId: true } },
              },
            },
          },
        });
        if (!order) throw new NotFoundException('Pedido no encontrado');
        this.ensureOpenOrder(order.status);

        if (order.items.length === 0) {
          throw new BadRequestException('No hay productos nuevos para enviar');
        }
        this.validateTablesForType(
          order.type,
          order.tables.map(({ tableId }) => tableId),
        );
        await this.validateItemsAvailability(tx, order.items);
        const now = new Date();
        await tx.orderItem.updateMany({
          where: {
            id: { in: order.items.map((item) => item.id) },
            status: OrderItemStatus.DRAFT,
          },
          data: { status: OrderItemStatus.PENDING, sentAt: now },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            status:
              order.status === OrderStatus.IN_PROGRESS
                ? OrderStatus.IN_PROGRESS
                : OrderStatus.SENT,
            sentAt: order.sentAt ?? now,
            notes: dto.notes ?? order.notes,
          },
        });
        if (order.tables.length) {
          await tx.table.updateMany({
            where: { id: { in: order.tables.map(({ tableId }) => tableId) } },
            data: { status: TableStatus.OCCUPIED },
          });
        }
        await this.createPrintJobs(tx, order, now);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.UPDATE,
            entity: 'Order',
            entityId: order.id,
            description: `Pedido #${order.number}: ${order.items.length} líneas nuevas enviadas a produccion`,
          },
        });
        return order.items.map((item) => item.id);
      },
      { isolationLevel: 'Serializable' },
    );
    const response = await this.findOne(params);
    this.operationsEvents.emitOrderSent(response);
    for (const item of response.items.filter((item) =>
      sentIds.includes(item.id),
    )) {
      if (item.productionArea === ProductionAreaCode.KITCHEN) {
        this.operationsEvents.emitKitchenItemCreated(item);
      } else if (item.productionArea === ProductionAreaCode.BAR) {
        this.operationsEvents.emitBarItemCreated(item);
      }
    }
    for (const table of response.tables) {
      this.operationsEvents.emitTableStatusChanged({
        tableId: table.id,
        status: TableStatus.OCCUPIED,
        orderId: response.id,
      });
    }
    const printJobs = await this.db.printJob.findMany({
      where: {
        orderId: response.id,
        items: { some: { orderItemId: { in: sentIds } } },
      },
      select: {
        id: true,
        printerId: true,
        orderId: true,
        type: true,
        status: true,
      },
    });
    for (const printJob of printJobs) {
      this.operationsEvents.emitPrintJobStatusChanged(printJob);
    }
    return response;
  }

  async cancel(
    params: OrderIdParamDto,
    dto: CancelOrderDto,
    user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    await this.db.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.id },
          select: {
            number: true,
            status: true,
            tables: { select: { tableId: true } },
          },
        });
        if (!order) throw new NotFoundException('Pedido no encontrado');
        if (
          order.status === OrderStatus.PAID ||
          order.status === OrderStatus.CANCELLED
        ) {
          throw new ConflictException('El pedido ya esta cerrado');
        }
        await ensureOrderUnbilled(tx, params.id);
        const now = new Date();
        await tx.order.update({
          where: { id: params.id },
          data: {
            status: OrderStatus.CANCELLED,
            closedAt: now,
            closedById: user.id,
          },
        });
        await tx.orderItem.updateMany({
          where: {
            orderId: params.id,
            status: { not: OrderItemStatus.CANCELLED },
          },
          data: {
            status: OrderItemStatus.CANCELLED,
            cancelledAt: now,
            cancelledById: user.id,
            cancellationReason: dto.reason,
          },
        });
        await this.releaseTables(
          tx,
          order.tables.map(({ tableId }) => tableId),
        );
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CANCEL,
            entity: 'Order',
            entityId: params.id,
            description: `Pedido #${order.number} cancelado: ${dto.reason}`,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    const response = await this.findOne(params);
    this.operationsEvents.emitOrderStatusChanged({
      orderId: response.id,
      status: response.status,
    });
    for (const item of response.items) {
      this.operationsEvents.emitOrderItemStatusChanged(
        item,
        item.productionArea === ProductionAreaCode.KITCHEN
          ? 'KITCHEN'
          : item.productionArea === ProductionAreaCode.BAR
            ? 'BAR'
            : undefined,
      );
    }
    for (const table of response.tables) {
      this.operationsEvents.emitTableStatusChanged({
        tableId: table.id,
        status: TableStatus.AVAILABLE,
        orderId: response.id,
      });
    }
    return response;
  }

  async cancelItem(
    params: OrderItemParamDto,
    dto: CancelOrderItemDto,
    user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    const cancelledItemId = await this.db.$transaction(
      async (tx) => {
        const item = await tx.orderItem.findFirst({
          where: { id: params.itemId, orderId: params.id },
        });
        if (!item) throw new NotFoundException('Item de pedido no encontrado');
        const order = await tx.order.findUniqueOrThrow({
          where: { id: params.id },
          select: { status: true },
        });
        if (order.status === OrderStatus.DRAFT) {
          throw new ConflictException(
            'Mientras el pedido esta en borrador el item debe editarse o eliminarse',
          );
        }
        if (
          order.status === OrderStatus.PAID ||
          order.status === OrderStatus.CANCELLED
        ) {
          throw new ConflictException('El pedido ya esta cerrado');
        }
        if (
          item.status === OrderItemStatus.CANCELLED ||
          item.status === OrderItemStatus.SERVED
        ) {
          throw new ConflictException('El item ya no puede cancelarse');
        }
        await ensureOrderUnbilled(tx, params.id);
        const quantity = dto.quantity ?? item.quantity;
        if (quantity > item.quantity) {
          throw new BadRequestException(
            'La cantidad a cancelar supera las unidades del producto',
          );
        }
        const cancelledAt = new Date();
        let cancelledItemId = item.id;
        if (quantity === item.quantity) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              status: OrderItemStatus.CANCELLED,
              cancelledAt,
              cancelledById: user.id,
              cancellationReason: dto.reason,
            },
          });
        } else {
          const modifiers = await tx.orderItemModifier.findMany({
            where: { orderItemId: item.id },
          });
          const combos = await tx.orderItemComboSelection.findMany({
            where: { orderItemId: item.id },
          });
          const unitTotal = item.unitPrice.add(item.modifiersPrice);
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              quantity: item.quantity - quantity,
              subtotal: unitTotal.mul(item.quantity - quantity),
            },
          });
          const cancelled = await tx.orderItem.create({
            data: {
              orderId: item.orderId,
              productId: item.productId,
              productVariantId: item.productVariantId,
              productNameSnapshot: item.productNameSnapshot,
              variantNameSnapshot: item.variantNameSnapshot,
              quantity,
              unitPrice: item.unitPrice,
              modifiersPrice: item.modifiersPrice,
              subtotal: unitTotal.mul(quantity),
              notes: item.notes,
              productionArea: item.productionArea,
              sentAt: item.sentAt,
              preparingAt: item.preparingAt,
              readyAt: item.readyAt,
              createdById: item.createdById,
              status: OrderItemStatus.CANCELLED,
              cancelledAt,
              cancelledById: user.id,
              cancellationReason: dto.reason,
            },
          });
          cancelledItemId = cancelled.id;
          if (modifiers.length)
            await tx.orderItemModifier.createMany({
              data: modifiers.map((option) => ({
                orderItemId: cancelled.id,
                modifierOptionId: option.modifierOptionId,
                groupNameSnapshot: option.groupNameSnapshot,
                optionNameSnapshot: option.optionNameSnapshot,
                priceDelta: option.priceDelta,
                quantity: option.quantity,
              })),
            });
          if (combos.length)
            await tx.orderItemComboSelection.createMany({
              data: combos.map((option) => ({
                orderItemId: cancelled.id,
                comboGroupItemId: option.comboGroupItemId,
                groupNameSnapshot: option.groupNameSnapshot,
                productNameSnapshot: option.productNameSnapshot,
                additionalPrice: option.additionalPrice,
              })),
            });
        }
        await this.recalculateTotals(tx, params.id);
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CANCEL,
            entity: 'OrderItem',
            entityId: cancelledItemId,
            description: `${quantity} de ${item.quantity} unidades de ${item.productNameSnapshot} canceladas (línea ${item.id}): ${dto.reason}`,
          },
        });
        return cancelledItemId;
      },
      { isolationLevel: 'Serializable' },
    );
    const response = await this.findOne({ id: params.id });
    for (const item of response.items.filter(
      (item) => item.id === params.itemId || item.id === cancelledItemId,
    )) {
      this.operationsEvents.emitOrderItemStatusChanged(
        item,
        item.productionArea === ProductionAreaCode.KITCHEN
          ? 'KITCHEN'
          : item.productionArea === ProductionAreaCode.BAR
            ? 'BAR'
            : undefined,
      );
    }
    this.operationsEvents.emitOrderStatusChanged({
      orderId: response.id,
      status: response.status,
    });
    return response;
  }

  async summary(params: OrderIdParamDto): Promise<OrderSummaryResponse> {
    const order = await this.db.order.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        number: true,
        status: true,
        subtotal: true,
        discount: true,
        total: true,
        _count: {
          select: {
            items: true,
          },
        },
        items: {
          where: { status: OrderItemStatus.CANCELLED },
          select: { id: true },
        },
        payments: {
          where: { status: 'COMPLETED' },
          select: { amount: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const paid = order.payments.reduce(
      (total, payment) => total.add(payment.amount),
      new Prisma.Decimal(0),
    );
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      subtotal: order.subtotal.toString(),
      discount: order.discount.toString(),
      total: order.total.toString(),
      paid: paid.toString(),
      pending: order.total.sub(paid).toString(),
      itemCount: order._count.items,
      cancelledItemCount: order.items.length,
    };
  }

  private async buildItemData(
    tx: Prisma.TransactionClient,
    dto: AddOrderItemDto,
    userId: string | null,
  ): Promise<Prisma.OrderItemUncheckedCreateWithoutOrderInput> {
    const productQuery = {
      where: { id: dto.productId },
      select: {
        id: true,
        name: true,
        basePrice: true,
        active: true,
        available: true,
        productionArea: { select: { code: true, active: true } },
        category: {
          select: {
            active: true,
            productionArea: { select: { code: true, active: true } },
          },
        },
        variants: {
          where: dto.productVariantId
            ? { id: dto.productVariantId }
            : { id: { in: [] } },
          select: {
            id: true,
            name: true,
            price: true,
            active: true,
            available: true,
          },
        },
        modifierGroups: {
          select: {
            modifierGroup: {
              select: {
                id: true,
                name: true,
                active: true,
                required: true,
                minSelections: true,
                maxSelections: true,
                options: {
                  where: { id: { in: dto.modifierOptionIds ?? [] } },
                  select: {
                    id: true,
                    name: true,
                    priceDelta: true,
                    active: true,
                    available: true,
                  },
                },
              },
            },
          },
        },
        comboGroups: {
          select: {
            id: true,
            name: true,
            minSelections: true,
            maxSelections: true,
            items: {
              where: {
                id: {
                  in:
                    dto.comboSelections?.flatMap(
                      (selection) => selection.comboGroupItemIds,
                    ) ?? [],
                },
              },
              select: {
                id: true,
                productNameSnapshot: true,
                additionalPrice: true,
                active: true,
              },
            },
          },
        },
      },
    } satisfies Prisma.ProductFindUniqueArgs;
    const {
      productionArea: areaSelection,
      category,
      variants,
      modifierGroups,
      comboGroups,
      ...fields
    } = productQuery.select;
    const row = await tx.product.findUnique({
      where: productQuery.where,
      select: { ...fields, categoryId: true, productionAreaId: true },
    });
    if (!row) throw new NotFoundException('Producto no encontrado');
    const categoryRow = await tx.category.findUniqueOrThrow({
      where: { id: row.categoryId },
      select: { active: category.select.active, productionAreaId: true },
    });
    const areas = await tx.productionArea.findMany({
      where: {
        id: {
          in: [row.productionAreaId, categoryRow.productionAreaId].filter(
            (id): id is string => id !== null,
          ),
        },
      },
      select: { id: true, ...areaSelection.select },
    });
    const areaById = new Map(areas.map((area) => [area.id, area]));
    const productVariants = await tx.productVariant.findMany({
      ...variants,
      where: { ...variants.where, productId: row.id },
    });
    const links = await tx.productModifierGroup.findMany({
      where: { productId: row.id },
      select: { modifierGroupId: true },
    });
    const { options, ...groupFields } =
      modifierGroups.select.modifierGroup.select;
    const groups = await tx.modifierGroup.findMany({
      where: { id: { in: links.map((link) => link.modifierGroupId) } },
      select: groupFields,
    });
    const groupOptions = await tx.modifierOption.findMany({
      where: {
        ...options.where,
        modifierGroupId: { in: groups.map((group) => group.id) },
      },
      select: { ...options.select, modifierGroupId: true },
    });
    const { items, ...comboFields } = comboGroups.select;
    const combos = await tx.comboGroup.findMany({
      where: { comboProductId: row.id },
      select: comboFields,
    });
    const components = await tx.comboGroupItem.findMany({
      where: {
        ...items.where,
        comboGroupId: { in: combos.map((group) => group.id) },
      },
      select: { ...items.select, comboGroupId: true },
    });
    const product = {
      ...row,
      productionArea: row.productionAreaId
        ? areaById.get(row.productionAreaId)
        : null,
      category: {
        ...categoryRow,
        productionArea: categoryRow.productionAreaId
          ? areaById.get(categoryRow.productionAreaId)
          : null,
      },
      variants: productVariants,
      modifierGroups: groups.map((group) => ({
        modifierGroup: {
          ...group,
          options: groupOptions.filter(
            (option) => option.modifierGroupId === group.id,
          ),
        },
      })),
      comboGroups: combos.map((group) => ({
        ...group,
        items: components.filter((item) => item.comboGroupId === group.id),
      })),
    };
    if (
      !product.active ||
      !product.available ||
      !product.category.active ||
      product.productionArea?.active === false ||
      product.category.productionArea?.active === false
    ) {
      throw new ConflictException('El producto no esta disponible');
    }
    const variant = dto.productVariantId ? product.variants[0] : undefined;
    if (dto.productVariantId && !variant) {
      throw new BadRequestException('La variante no pertenece al producto');
    }
    if (variant && (!variant.active || !variant.available)) {
      throw new ConflictException('La variante no esta disponible');
    }
    const selectedOptionIds = new Set(dto.modifierOptionIds ?? []);
    const selectedOptions = product.modifierGroups.flatMap(
      ({ modifierGroup }) => {
        if (!modifierGroup.active) return [];
        const count = modifierGroup.options.length;
        if (
          (modifierGroup.required || count > 0) &&
          count < modifierGroup.minSelections
        ) {
          throw new BadRequestException(
            `Debe seleccionar al menos ${modifierGroup.minSelections} opcion(es) de ${modifierGroup.name}`,
          );
        }
        if (
          modifierGroup.maxSelections !== null &&
          count > modifierGroup.maxSelections
        ) {
          throw new BadRequestException(
            `Solo puede seleccionar ${modifierGroup.maxSelections} opcion(es) de ${modifierGroup.name}`,
          );
        }
        for (const option of modifierGroup.options) {
          if (!option.active || !option.available) {
            throw new ConflictException(
              `La opcion ${option.name} no esta disponible`,
            );
          }
          selectedOptionIds.delete(option.id);
        }
        return modifierGroup.options.map((option) => ({
          modifierOptionId: option.id,
          groupNameSnapshot: modifierGroup.name,
          optionNameSnapshot: option.name,
          priceDelta: option.priceDelta,
        }));
      },
    );
    if (selectedOptionIds.size > 0) {
      throw new BadRequestException(
        'Una o mas opciones no pertenecen a los modificadores del producto',
      );
    }
    const requestedCombos = new Map(
      (dto.comboSelections ?? []).map((selection) => [
        selection.comboGroupId,
        new Set(selection.comboGroupItemIds),
      ]),
    );
    const comboSelections = product.comboGroups.flatMap((group) => {
      const requested = requestedCombos.get(group.id) ?? new Set<string>();
      const selected = group.items.filter((item) => requested.has(item.id));
      if (selected.length !== requested.size) {
        throw new BadRequestException(
          `Una opcion seleccionada no pertenece al grupo ${group.name}`,
        );
      }
      if (
        selected.length < group.minSelections ||
        selected.length > group.maxSelections
      ) {
        throw new BadRequestException(
          `El grupo ${group.name} requiere entre ${group.minSelections} y ${group.maxSelections} seleccion(es)`,
        );
      }
      if (selected.some((item) => !item.active)) {
        throw new ConflictException(
          `Una opcion de ${group.name} no esta disponible`,
        );
      }
      requestedCombos.delete(group.id);
      return selected.map((item) => ({
        comboGroupItemId: item.id,
        groupNameSnapshot: group.name,
        productNameSnapshot: item.productNameSnapshot,
        additionalPrice: item.additionalPrice,
      }));
    });
    if (requestedCombos.size > 0) {
      throw new BadRequestException(
        'Un grupo de combo no pertenece al producto',
      );
    }
    const unitPrice = variant?.price ?? product.basePrice;
    const modifiersPrice = [...selectedOptions, ...comboSelections].reduce(
      (total, item) =>
        total.add(
          'priceDelta' in item ? item.priceDelta : item.additionalPrice,
        ),
      new Prisma.Decimal(0),
    );
    const productionArea =
      product.productionArea?.code ??
      product.category.productionArea?.code ??
      ProductionAreaCode.NONE;
    return {
      productId: product.id,
      productVariantId: variant?.id,
      productNameSnapshot: product.name,
      variantNameSnapshot: variant?.name,
      quantity: dto.quantity,
      unitPrice,
      modifiersPrice,
      subtotal: unitPrice.add(modifiersPrice).mul(dto.quantity),
      notes: dto.notes,
      productionArea,
      createdById: userId,
      modifiers: { create: selectedOptions },
      comboSelections: { create: comboSelections },
    };
  }

  private async validateItemsAvailability(
    tx: Prisma.TransactionClient,
    items: Array<{
      id: string;
      productId: string | null;
      productVariantId: string | null;
      modifiers: Array<{ modifierOptionId: string | null }>;
      comboSelections: Array<{ comboGroupItemId: string | null }>;
    }>,
  ): Promise<void> {
    const productIds = items.flatMap((item) =>
      item.productId ? [item.productId] : [],
    );
    const variantIds = items.flatMap((item) =>
      item.productVariantId ? [item.productVariantId] : [],
    );
    const optionIds = items.flatMap((item) =>
      item.modifiers.flatMap(({ modifierOptionId }) =>
        modifierOptionId ? [modifierOptionId] : [],
      ),
    );
    const comboItemIds = items.flatMap((item) =>
      item.comboSelections.flatMap(({ comboGroupItemId }) =>
        comboGroupItemId ? [comboGroupItemId] : [],
      ),
    );
    const [products, variants, options, comboItems] = await Promise.all([
      tx.product.count({
        where: { id: { in: productIds }, active: true, available: true },
      }),
      tx.productVariant.count({
        where: { id: { in: variantIds }, active: true, available: true },
      }),
      tx.modifierOption.count({
        where: { id: { in: optionIds }, active: true, available: true },
      }),
      tx.comboGroupItem.count({
        where: { id: { in: comboItemIds }, active: true },
      }),
    ]);
    if (
      products !== new Set(productIds).size ||
      variants !== new Set(variantIds).size ||
      options !== new Set(optionIds).size ||
      comboItems !== new Set(comboItemIds).size
    ) {
      throw new ConflictException(
        'El pedido contiene productos, variantes u opciones que ya no estan disponibles',
      );
    }
  }

  private async createPrintJobs(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      number: number;
      items: Array<{
        id: string;
        productNameSnapshot: string;
        quantity: number;
        notes: string | null;
        productionArea: ProductionAreaCode;
      }>;
    },
    sentAt: Date,
  ): Promise<void> {
    const sends = await tx.orderItem.groupBy({
      by: ['orderId', 'sentAt'],
      where: { orderId: order.id, sentAt: { not: null } },
    });
    const roundNumber = orderRoundNumbers(sends).get(
      `${order.id}:${sentAt.toISOString()}`,
    )!;
    const sentTime = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(sentAt);
    const areas = [...new Set(order.items.map((item) => item.productionArea))];
    const printers = await tx.printer.findMany({
      where: {
        active: true,
        status: PrinterStatus.ACTIVE,
        OR: [
          { purpose: PrinterPurpose.GENERAL },
          { productionArea: { code: { in: areas } } },
        ],
      },
      select: {
        id: true,
        purpose: true,
        productionArea: { select: { code: true } },
      },
    });
    for (const printer of printers) {
      const printerAreas =
        printer.purpose === PrinterPurpose.GENERAL
          ? areas.filter((area) => area !== ProductionAreaCode.NONE)
          : printer.productionArea
            ? [printer.productionArea.code]
            : [];
      for (const area of printerAreas) {
        const items = order.items.filter(
          (item) => item.productionArea === area,
        );
        if (!items.length) continue;
        const type =
          area === ProductionAreaCode.BAR
            ? PrintJobType.BAR_COMMAND
            : PrintJobType.KITCHEN_COMMAND;
        await tx.printJob.create({
          data: {
            printerId: printer.id,
            orderId: order.id,
            type,
            payload: {
              orderNumber: order.number,
              productionArea: area,
              roundNumber,
              sentAt: sentAt.toISOString(),
              lines: [
                `${area} | Pedido #${order.number}`,
                `Ronda ${roundNumber}${roundNumber > 1 ? ' | Adicional' : ''}`,
                `Enviada: ${sentTime} | Lima`,
                ...items.flatMap((item) => [
                  `${item.quantity} x ${item.productNameSnapshot}`,
                  ...(item.notes ? ['  ' + item.notes] : []),
                ]),
              ],
              items,
            },
            items: {
              create: items.map((item) => ({ orderItemId: item.id })),
            },
          },
        });
      }
    }
  }

  private async validateTables(
    tx: Prisma.TransactionClient,
    tableIds: string[],
    currentOrderId?: string,
  ): Promise<void> {
    if (!tableIds.length) return;
    const tables = await tx.table.findMany({
      where: { id: { in: tableIds } },
      select: {
        id: true,
        active: true,
        status: true,
        orderTables: {
          where: {
            order: {
              status: { in: OPEN_STATUSES },
              ...(currentOrderId ? { id: { not: currentOrderId } } : {}),
            },
          },
          take: 1,
          select: { orderId: true },
        },
      },
    });
    if (tables.length !== tableIds.length) {
      throw new NotFoundException('Una o mas mesas no existen');
    }
    if (
      tables.some(
        (table) =>
          !table.active ||
          table.status !== TableStatus.AVAILABLE ||
          table.orderTables.length > 0,
      )
    ) {
      throw new ConflictException('Una o mas mesas no estan disponibles');
    }
  }

  private validateTablesForType(type: OrderType, tableIds: string[]): void {
    if (type === OrderType.DINE_IN && tableIds.length === 0) {
      throw new BadRequestException(
        'Un pedido en mesa requiere al menos una mesa',
      );
    }
    if (type !== OrderType.DINE_IN && tableIds.length > 0) {
      throw new BadRequestException(
        'Solo los pedidos en mesa pueden tener mesas',
      );
    }
  }

  private async recalculateTotals(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const result = await tx.orderItem.aggregate({
      where: { orderId, status: { not: OrderItemStatus.CANCELLED } },
      _sum: { subtotal: true },
    });
    const subtotal = result._sum.subtotal ?? new Prisma.Decimal(0);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { discount: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        total: Prisma.Decimal.max(subtotal.sub(order.discount), 0),
      },
    });
  }

  private async releaseTables(
    tx: Prisma.TransactionClient,
    tableIds: string[],
  ): Promise<void> {
    if (!tableIds.length) return;
    await tx.table.updateMany({
      where: { id: { in: tableIds }, active: true },
      data: { status: TableStatus.AVAILABLE },
    });
  }

  private async getOrderState(id: string) {
    const order = await this.db.order.findUnique({
      where: { id },
      select: { type: true, status: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  private ensureOpenOrder(status: OrderStatus): void {
    if (status === OrderStatus.PAID || status === OrderStatus.CANCELLED) {
      throw new ConflictException('El pedido ya esta cerrado');
    }
  }

  private ensureDraft(status: OrderStatus | OrderItemStatus): void {
    if (status !== OrderStatus.DRAFT) {
      throw new ConflictException(
        'Solo se puede modificar un pedido en borrador',
      );
    }
  }

  private ensureBody(dto: object): void {
    if (!Object.keys(dto).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
  }

  private toResponse(order: OrderRecord): OrderDetailResponse {
    const { subtotal, discount, total, tables, items, ...data } = order;
    const rounds = orderRoundNumbers(
      items.map((item) => ({ orderId: order.id, sentAt: item.sentAt })),
    );
    return {
      ...data,
      subtotal: subtotal.toString(),
      discount: discount.toString(),
      total: total.toString(),
      tables: tables.map(({ table, joinedAt }) => ({ ...table, joinedAt })),
      items: items.map(
        ({
          unitPrice,
          modifiersPrice,
          subtotal: itemSubtotal,
          modifiers,
          comboSelections,
          ...item
        }) => ({
          ...item,
          roundNumber: item.sentAt
            ? (rounds.get(`${order.id}:${item.sentAt.toISOString()}`) ?? null)
            : null,
          unitPrice: unitPrice.toString(),
          modifiersPrice: modifiersPrice.toString(),
          subtotal: itemSubtotal.toString(),
          modifiers: modifiers.map(({ priceDelta, ...modifier }) => ({
            ...modifier,
            priceDelta: priceDelta.toString(),
          })),
          comboSelections: comboSelections.map(
            ({ additionalPrice, ...selection }) => ({
              ...selection,
              additionalPrice: additionalPrice.toString(),
            }),
          ),
        }),
      ),
    };
  }
}
