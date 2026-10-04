import { DatabaseService } from '@/database/database.service';
import type { Prisma } from '@/generated/prisma/client';
import { FileType } from '@/generated/prisma/enums';
import { FilesService } from '@/modules/files/files.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttachCategoryImageDto } from './dto/attach-category-image.dto';
import { CategoryIdParamDto } from './dto/category-id-param.dto';
import { CategoryImageParamDto } from './dto/category-image-param.dto';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryImageDto } from './dto/update-category-image.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponse } from './interfaces/category.interface';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  productionArea: {
    select: { id: true, name: true, code: true, active: true },
  },
  images: {
    select: {
      id: true,
      fileId: true,
      sortOrder: true,
      file: {
        select: {
          originalName: true,
          mimeType: true,
          size: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  _count: { select: { products: true } },
} satisfies Prisma.CategorySelect;

type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly filesService: FilesService,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryResponse> {
    if (dto.productionAreaId) {
      await this.ensureActiveProductionArea(dto.productionAreaId);
    }
    try {
      const category = await this.db.category.create({
        data: dto,
        select: CATEGORY_SELECT,
      });
      return this.toResponse(category);
    } catch (error: unknown) {
      this.rethrowCategoryConflict(error);
      throw error;
    }
  }

  async findAll(query: CategoryQueryDto): Promise<CategoryResponse[]> {
    const categories = await this.db.category.findMany({
      where: {
        active: query.active,
        productionAreaId: query.productionAreaId,
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
      },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(categories.map((category) => this.toResponse(category)));
  }

  async findOne(params: CategoryIdParamDto): Promise<CategoryResponse> {
    const category = await this.getCategory(params.id);
    return this.toResponse(category);
  }

  async update(
    params: CategoryIdParamDto,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    if (dto.productionAreaId) {
      await this.ensureActiveProductionArea(dto.productionAreaId);
    }
    if (dto.active === true) {
      await this.ensureCategoryCanActivate(params.id, dto.productionAreaId);
    }
    try {
      const updated = await this.db.category.updateMany({
        where: { id: params.id },
        data: dto,
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Categoria no encontrada');
      }
      return this.findOne(params);
    } catch (error: unknown) {
      this.rethrowCategoryConflict(error);
      throw error;
    }
  }

  async updateStatus(
    params: CategoryIdParamDto,
    dto: UpdateCategoryStatusDto,
  ): Promise<CategoryResponse> {
    if (dto.active) {
      await this.ensureCategoryCanActivate(params.id);
    }
    const updated = await this.db.category.updateMany({
      where: { id: params.id },
      data: { active: dto.active },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Categoria no encontrada');
    }
    return this.findOne(params);
  }

  async attachImage(
    params: CategoryIdParamDto,
    dto: AttachCategoryImageDto,
  ): Promise<CategoryResponse> {
    await this.ensureCategoryExists(params.id);
    await this.filesService.assertFileType(dto.fileId, FileType.CATEGORY_IMAGE);
    try {
      await this.db.categoryImage.create({
        data: {
          categoryId: params.id,
          fileId: dto.fileId,
          sortOrder: dto.sortOrder,
        },
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'La imagen ya esta asociada a la categoria',
        );
      }
      throw error;
    }
    return this.findOne(params);
  }

  async updateImage(
    params: CategoryImageParamDto,
    dto: UpdateCategoryImageDto,
  ): Promise<CategoryResponse> {
    const updated = await this.db.categoryImage.updateMany({
      where: { categoryId: params.id, fileId: params.fileId },
      data: { sortOrder: dto.sortOrder },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Imagen de categoria no encontrada');
    }
    return this.findOne({ id: params.id });
  }

  async removeImage(params: CategoryImageParamDto): Promise<CategoryResponse> {
    const deleted = await this.db.categoryImage.deleteMany({
      where: { categoryId: params.id, fileId: params.fileId },
    });
    if (deleted.count !== 1) {
      throw new NotFoundException('Imagen de categoria no encontrada');
    }
    return this.findOne({ id: params.id });
  }

  private async ensureActiveProductionArea(id: string): Promise<void> {
    const area = await this.db.productionArea.findUnique({
      where: { id },
      select: { active: true },
    });
    if (!area) {
      throw new NotFoundException('Area de produccion no encontrada');
    }
    if (!area.active) {
      throw new ConflictException(
        'No se puede asociar una categoria a un area de produccion inactiva',
      );
    }
  }

  private async ensureCategoryCanActivate(
    categoryId: string,
    nextProductionAreaId?: string | null,
  ): Promise<void> {
    if (nextProductionAreaId === null) return;
    if (nextProductionAreaId) {
      await this.ensureActiveProductionArea(nextProductionAreaId);
      return;
    }
    const category = await this.db.category.findUnique({
      where: { id: categoryId },
      select: { productionArea: { select: { active: true } } },
    });
    if (!category) {
      throw new NotFoundException('Categoria no encontrada');
    }
    if (category.productionArea && !category.productionArea.active) {
      throw new ConflictException(
        'La categoria no puede activarse con un area de produccion inactiva',
      );
    }
  }

  private async ensureCategoryExists(id: string): Promise<void> {
    const category = await this.db.category.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Categoria no encontrada');
    }
  }

  private async getCategory(id: string): Promise<CategoryRecord> {
    const category = await this.db.category.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!category) {
      throw new NotFoundException('Categoria no encontrada');
    }
    return category;
  }

  private async toResponse(
    category: CategoryRecord,
  ): Promise<CategoryResponse> {
    const { images, _count, ...data } = category;
    return {
      ...data,
      productCount: _count.products,
      images: await Promise.all(
        images.map(async ({ file, ...image }) => ({
          ...image,
          ...file,
          url: await this.filesService.createPresignedUrl(image.fileId),
        })),
      ),
    };
  }

  private rethrowCategoryConflict(error: unknown): void {
    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('Ya existe una categoria con ese nombre');
    }
  }

  private isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
