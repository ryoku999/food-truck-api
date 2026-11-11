import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import { OrderStatus, TableStatus } from '@/generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTableDto } from './dto/create-table.dto';
import { TableIdParamDto } from './dto/table-id-param.dto';
import { TableMapQueryDto } from './dto/table-map-query.dto';
import { TableQueryDto } from './dto/table-query.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import {
  TableDetailResponse,
  TableMapResponse,
  TableOpenOrderResponse,
  TableResponse,
} from './interfaces/table.interface';

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SENT,
  OrderStatus.IN_PROGRESS,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const TABLE_SELECT = {
  id: true,
  number: true,
  name: true,
  capacity: true,
  status: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  diningArea: { select: { id: true, name: true } },
} satisfies Prisma.TableSelect;

const OPEN_ORDER_TABLE_SELECT = {
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      openedAt: true,
      tables: {
        select: {
          table: {
            select: {
              id: true,
              number: true,
              name: true,
              diningArea: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderTableSelect;

type OpenOrderTableRecord = Prisma.OrderTableGetPayload<{
  select: typeof OPEN_ORDER_TABLE_SELECT;
}>;

@Injectable()
export class TablesService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateTableDto): Promise<TableResponse> {
    await this.ensureActiveDiningArea(dto.diningAreaId);
    try {
      return await this.db.table.create({
        data: dto,
        select: TABLE_SELECT,
      });
    } catch (error: unknown) {
      this.rethrowDuplicateNumber(error);
      throw error;
    }
  }

  async findAll(query: TableQueryDto): Promise<TableResponse[]> {
    const numericSearch = query.search ? Number(query.search) : Number.NaN;
    const where: Prisma.TableWhereInput = {
      diningAreaId: query.diningAreaId,
      status: query.status,
      active: query.active,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              ...(Number.isInteger(numericSearch)
                ? [{ number: numericSearch }]
                : []),
            ],
          }
        : {}),
    };
    return this.db.table.findMany({
      where,
      select: TABLE_SELECT,
      orderBy: [
        { diningArea: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
        { number: 'asc' },
      ],
    });
  }

  async findOne(params: TableIdParamDto): Promise<TableDetailResponse> {
    const table = await this.db.table.findUnique({
      where: { id: params.id },
      select: {
        ...TABLE_SELECT,
        orderTables: {
          where: { order: { status: { in: OPEN_ORDER_STATUSES } } },
          select: OPEN_ORDER_TABLE_SELECT,
          orderBy: { joinedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!table) {
      throw new NotFoundException('Mesa no encontrada');
    }
    const { orderTables, ...record } = table;
    return {
      ...record,
      openOrder: orderTables[0]
        ? this.toOpenOrder(orderTables[0], table.id)
        : null,
    };
  }

  async getMap(query: TableMapQueryDto): Promise<TableMapResponse> {
    const areas = await this.db.diningArea.findMany({
      where: {
        id: query.diningAreaId,
        ...(query.includeInactive ? {} : { active: true }),
      },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        active: true,
        tables: {
          where: query.includeInactive ? {} : { active: true },
          select: {
            id: true,
            number: true,
            name: true,
            capacity: true,
            status: true,
            active: true,
            sortOrder: true,
            orderTables: {
              where: { order: { status: { in: OPEN_ORDER_STATUSES } } },
              select: OPEN_ORDER_TABLE_SELECT,
              orderBy: { joinedAt: 'desc' },
              take: 1,
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      areas: areas.map((area) => ({
        ...area,
        tables: area.tables.map(({ orderTables, ...table }) => ({
          ...table,
          openOrder: orderTables[0]
            ? this.toOpenOrder(orderTables[0], table.id)
            : null,
        })),
      })),
    };
  }

  async update(
    params: TableIdParamDto,
    dto: UpdateTableDto,
  ): Promise<TableDetailResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    if (dto.diningAreaId) {
      await this.ensureActiveDiningArea(dto.diningAreaId);
    }
    if (dto.active === false) {
      await this.ensureNoOpenOrder(params.id);
    }
    try {
      const updated = await this.db.table.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Mesa no encontrada');
      }
      return this.findOne(params);
    } catch (error: unknown) {
      this.rethrowDuplicateNumber(error);
      throw error;
    }
  }

  async updateStatus(
    params: TableIdParamDto,
    dto: UpdateTableStatusDto,
  ): Promise<TableDetailResponse> {
    const openOrders = await this.countOpenOrders(params.id);
    if (dto.status === TableStatus.OCCUPIED && openOrders === 0) {
      throw new ConflictException(
        'Una mesa solo puede marcarse ocupada mediante un pedido abierto',
      );
    }
    if (dto.status !== TableStatus.OCCUPIED && openOrders > 0) {
      throw new ConflictException(
        'La mesa tiene un pedido abierto y no puede liberarse o deshabilitarse',
      );
    }
    const updated = await this.db.table.updateMany({
      where: { id: params.id },
      data: { status: dto.status },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Mesa no encontrada');
    }
    return this.findOne(params);
  }

  private async ensureActiveDiningArea(diningAreaId: string): Promise<void> {
    const area = await this.db.diningArea.findUnique({
      where: { id: diningAreaId },
      select: { active: true },
    });
    if (!area) {
      throw new NotFoundException('Area del local no encontrada');
    }
    if (!area.active) {
      throw new ConflictException(
        'No se pueden asignar mesas a un area inactiva',
      );
    }
  }

  private async ensureNoOpenOrder(tableId: string): Promise<void> {
    if ((await this.countOpenOrders(tableId)) > 0) {
      throw new ConflictException(
        'La mesa tiene un pedido abierto y no puede desactivarse',
      );
    }
  }

  private countOpenOrders(tableId: string): Promise<number> {
    return this.db.orderTable.count({
      where: { tableId, order: { status: { in: OPEN_ORDER_STATUSES } } },
    });
  }

  private toOpenOrder(
    relation: OpenOrderTableRecord,
    currentTableId: string,
  ): TableOpenOrderResponse {
    return {
      id: relation.order.id,
      number: relation.order.number,
      status: relation.order.status,
      total: relation.order.total.toString(),
      openedAt: relation.order.openedAt,
      joinedTables: relation.order.tables
        .map(({ table }) => table)
        .filter((table) => table.id !== currentTableId),
    };
  }

  private rethrowDuplicateNumber(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe una mesa con ese numero dentro del area',
      );
    }
  }
}
