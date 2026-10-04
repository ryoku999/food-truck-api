import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDiningAreaDto } from './dto/create-dining-area.dto';
import { DiningAreaIdParamDto } from './dto/dining-area-id-param.dto';
import { DiningAreaQueryDto } from './dto/dining-area-query.dto';
import { UpdateDiningAreaStatusDto } from './dto/update-dining-area-status.dto';
import { UpdateDiningAreaDto } from './dto/update-dining-area.dto';
import {
  DiningAreaDetailResponse,
  DiningAreaResponse,
} from './interfaces/dining-area.interface';

const DINING_AREA_SELECT = {
  id: true,
  name: true,
  description: true,
  sortOrder: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { tables: true } },
} satisfies Prisma.DiningAreaSelect;

type DiningAreaRecord = Prisma.DiningAreaGetPayload<{
  select: typeof DINING_AREA_SELECT;
}>;

@Injectable()
export class DiningAreasService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateDiningAreaDto): Promise<DiningAreaResponse> {
    try {
      const area = await this.db.diningArea.create({
        data: dto,
        select: DINING_AREA_SELECT,
      });
      return this.toResponse(area, 0);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
      throw error;
    }
  }

  async findAll(query: DiningAreaQueryDto): Promise<DiningAreaResponse[]> {
    const areas = await this.db.diningArea.findMany({
      where: {
        active: query.active,
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      select: {
        ...DINING_AREA_SELECT,
        tables: {
          where: { active: true },
          select: { id: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return areas.map(({ tables, ...area }) =>
      this.toResponse(area, tables.length),
    );
  }

  async findOne(
    params: DiningAreaIdParamDto,
  ): Promise<DiningAreaDetailResponse> {
    const area = await this.db.diningArea.findUnique({
      where: { id: params.id },
      select: {
        ...DINING_AREA_SELECT,
        tables: {
          select: {
            id: true,
            number: true,
            name: true,
            capacity: true,
            status: true,
            active: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
        },
      },
    });
    if (!area) {
      throw new NotFoundException('Area del local no encontrada');
    }
    const { tables, ...record } = area;
    return {
      ...this.toResponse(record, tables.filter((table) => table.active).length),
      tables,
    };
  }

  async update(
    params: DiningAreaIdParamDto,
    dto: UpdateDiningAreaDto,
  ): Promise<DiningAreaDetailResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    if (dto.active === false) {
      await this.ensureNoActiveTables(params.id);
    }
    try {
      const updated = await this.db.diningArea.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Area del local no encontrada');
      }
      return this.findOne(params);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
      throw error;
    }
  }

  async updateStatus(
    params: DiningAreaIdParamDto,
    dto: UpdateDiningAreaStatusDto,
  ): Promise<DiningAreaDetailResponse> {
    if (!dto.active) {
      await this.ensureNoActiveTables(params.id);
    }
    const updated = await this.db.diningArea.updateMany({
      where: { id: params.id },
      data: { active: dto.active },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Area del local no encontrada');
    }
    return this.findOne(params);
  }

  private async ensureNoActiveTables(diningAreaId: string): Promise<void> {
    const activeTables = await this.db.table.count({
      where: { diningAreaId, active: true },
    });
    if (activeTables > 0) {
      throw new ConflictException(
        'Debe desactivar las mesas del area antes de desactivar el area',
      );
    }
  }

  private toResponse(
    area: DiningAreaRecord,
    activeTableCount: number,
  ): DiningAreaResponse {
    const { _count, ...data } = area;
    return { ...data, tableCount: _count.tables, activeTableCount };
  }

  private rethrowUniqueName(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un area del local con ese nombre');
    }
  }
}
