import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductionAreaDto } from './dto/create-production-area.dto';
import { ProductionAreaIdParamDto } from './dto/production-area-id-param.dto';
import { ProductionAreaQueryDto } from './dto/production-area-query.dto';
import { UpdateProductionAreaStatusDto } from './dto/update-production-area-status.dto';
import { UpdateProductionAreaDto } from './dto/update-production-area.dto';
import { ProductionAreaResponse } from './interfaces/production-area.interface';

const PRODUCTION_AREA_SELECT = {
  id: true,
  name: true,
  code: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      categories: true,
      products: true,
      printers: true,
    },
  },
} satisfies Prisma.ProductionAreaSelect;

type ProductionAreaRecord = Prisma.ProductionAreaGetPayload<{
  select: typeof PRODUCTION_AREA_SELECT;
}>;

@Injectable()
export class ProductionAreasService {
  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateProductionAreaDto): Promise<ProductionAreaResponse> {
    try {
      const area = await this.db.productionArea.create({
        data: dto,
        select: PRODUCTION_AREA_SELECT,
      });
      return this.toResponse(area);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
      throw error;
    }
  }

  async findAll(
    query: ProductionAreaQueryDto,
  ): Promise<ProductionAreaResponse[]> {
    const where: Prisma.ProductionAreaWhereInput = {
      code: query.code,
      active: query.active,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const areas = await this.db.productionArea.findMany({
      where,
      select: PRODUCTION_AREA_SELECT,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return areas.map((area) => this.toResponse(area));
  }

  async findOne(
    params: ProductionAreaIdParamDto,
  ): Promise<ProductionAreaResponse> {
    const area = await this.db.productionArea.findUnique({
      where: { id: params.id },
      select: PRODUCTION_AREA_SELECT,
    });
    if (!area) {
      throw new NotFoundException('Area de produccion no encontrada');
    }
    return this.toResponse(area);
  }

  async update(
    params: ProductionAreaIdParamDto,
    dto: UpdateProductionAreaDto,
  ): Promise<ProductionAreaResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    try {
      const updated = await this.db.productionArea.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Area de produccion no encontrada');
      }
      return this.findOne(params);
    } catch (error: unknown) {
      this.rethrowUniqueName(error);
      throw error;
    }
  }

  async updateStatus(
    params: ProductionAreaIdParamDto,
    dto: UpdateProductionAreaStatusDto,
  ): Promise<ProductionAreaResponse> {
    const updated = await this.db.productionArea.updateMany({
      where: { id: params.id },
      data: { active: dto.active },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Area de produccion no encontrada');
    }
    return this.findOne(params);
  }

  private toResponse(area: ProductionAreaRecord): ProductionAreaResponse {
    const { _count, ...data } = area;
    return {
      ...data,
      counts: {
        categories: _count.categories,
        products: _count.products,
        printers: _count.printers,
      },
    };
  }

  private rethrowUniqueName(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe un area de produccion con ese nombre',
      );
    }
  }
}
