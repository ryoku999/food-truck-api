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
import {
  MenuQueryDto,
  ProductAdminQueryDto,
  CreateProductDto,
  UpdateAvailabilityDto,
  UpdateProductDto,
  UpdateProductStatusDto,
} from './dto/product.dto';
import {
  ComboGroupIdParamDto,
  ComboGroupItemIdParamDto,
  ProductIdParamDto,
  ProductImageParamDto,
  ProductModifierGroupParamDto,
  ProductVariantIdParamDto,
} from './dto/product-params.dto';
import {
  AttachProductImageDto,
  CreateComboGroupDto,
  CreateComboGroupItemDto,
  CreateProductVariantDto,
  SetProductModifierGroupsDto,
  UpdateComboGroupDto,
  UpdateComboGroupItemDto,
  UpdateProductImageDto,
  UpdateProductVariantDto,
} from './dto/product-relations.dto';
import {
  ComboGroupResponse,
  MenuResponse,
  MessageResponse,
  PaginatedProductsResponse,
  ProductDetailResponse,
  ProductVariantResponse,
} from './interfaces/product.interface';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  basePrice: true,
  active: true,
  available: true,
  featured: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, active: true } },
  productionArea: {
    select: { id: true, name: true, code: true, active: true },
  },
  images: {
    select: {
      id: true,
      fileId: true,
      isPrimary: true,
      sortOrder: true,
      file: { select: { originalName: true, mimeType: true, size: true } },
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  },
  variants: {
    select: {
      id: true,
      productId: true,
      name: true,
      price: true,
      active: true,
      available: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
  modifierGroups: {
    select: {
      sortOrder: true,
      modifierGroup: {
        select: {
          id: true,
          name: true,
          description: true,
          selectionType: true,
          minSelections: true,
          maxSelections: true,
          required: true,
          active: true,
          options: {
            select: {
              id: true,
              name: true,
              priceDelta: true,
              active: true,
              available: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
  comboGroups: {
    select: {
      id: true,
      comboProductId: true,
      name: true,
      minSelections: true,
      maxSelections: true,
      sortOrder: true,
      items: {
        select: {
          id: true,
          productId: true,
          productNameSnapshot: true,
          additionalPrice: true,
          active: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type ProductRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SELECT;
}>;

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly filesService: FilesService,
  ) {}

  async create(dto: CreateProductDto): Promise<ProductDetailResponse> {
    await this.validateProductRelations(dto.categoryId, dto.productionAreaId);
    const product = await this.db.product.create({
      data: dto,
      select: PRODUCT_SELECT,
    });
    return this.toResponse(product);
  }

  async findAll(
    query: ProductAdminQueryDto,
  ): Promise<PaginatedProductsResponse> {
    const where: Prisma.ProductWhereInput = {
      categoryId: query.categoryId,
      productionAreaId: query.productionAreaId,
      active: query.active,
      available: query.available,
      featured: query.featured,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction<
      [ProductRecord[], number]
    >(
      async (tx) => {
        const {
          category,
          productionArea,
          images,
          variants,
          modifierGroups,
          comboGroups,
          ...fields
        } = PRODUCT_SELECT;
        const products = await tx.product.findMany({
          where,
          select: { ...fields, categoryId: true, productionAreaId: true },
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const total = await tx.product.count({ where });
        if (!products.length) return [[], total];

        const productIds = products.map(({ id }) => id);
        const categories = await tx.category.findMany({
          where: { id: { in: products.map(({ categoryId }) => categoryId) } },
          select: category.select,
        });
        const areas = await tx.productionArea.findMany({
          where: {
            id: {
              in: products.flatMap(
                ({ productionAreaId }) => productionAreaId ?? [],
              ),
            },
          },
          select: productionArea.select,
        });
        const { file, ...imageFields } = images.select;
        const productImages = await tx.productImage.findMany({
          where: { productId: { in: productIds } },
          select: { ...imageFields, productId: true },
          orderBy: images.orderBy,
        });
        const files = await tx.file.findMany({
          where: { id: { in: productImages.map(({ fileId }) => fileId) } },
          select: { id: true, ...file.select },
        });
        const productVariants = await tx.productVariant.findMany({
          where: { productId: { in: productIds } },
          ...variants,
        });
        const groupLinks = await tx.productModifierGroup.findMany({
          where: { productId: { in: productIds } },
          select: { productId: true, modifierGroupId: true, sortOrder: true },
          orderBy: modifierGroups.orderBy,
        });
        const { options, ...modifierFields } =
          modifierGroups.select.modifierGroup.select;
        const modifierIds = groupLinks.map(
          ({ modifierGroupId }) => modifierGroupId,
        );
        const groups = await tx.modifierGroup.findMany({
          where: { id: { in: modifierIds } },
          select: modifierFields,
        });
        const groupOptions = await tx.modifierOption.findMany({
          where: { modifierGroupId: { in: modifierIds } },
          select: { ...options.select, modifierGroupId: true },
          orderBy: options.orderBy,
        });
        const { items: comboItems, ...comboFields } = comboGroups.select;
        const combos = await tx.comboGroup.findMany({
          where: { comboProductId: { in: productIds } },
          select: comboFields,
          orderBy: comboGroups.orderBy,
        });
        const components = await tx.comboGroupItem.findMany({
          where: { comboGroupId: { in: combos.map(({ id }) => id) } },
          select: { ...comboItems.select, comboGroupId: true },
          orderBy: comboItems.orderBy,
        });

        const categoryById = new Map(categories.map((row) => [row.id, row]));
        const areaById = new Map(areas.map((row) => [row.id, row]));
        const fileById = new Map(files.map(({ id, ...row }) => [id, row]));
        const imagesByProduct = groupBy(productImages, (row) => row.productId);
        const variantsByProduct = groupBy(
          productVariants,
          (row) => row.productId,
        );
        const linksByProduct = groupBy(groupLinks, (row) => row.productId);
        const optionsByGroup = groupBy(
          groupOptions,
          (row) => row.modifierGroupId,
        );
        const modifierById = new Map(
          groups.map((row) => [
            row.id,
            {
              ...row,
              options: (optionsByGroup.get(row.id) ?? []).map(
                ({ modifierGroupId, ...option }) => {
                  void modifierGroupId;
                  return option;
                },
              ),
            },
          ]),
        );
        const combosByProduct = groupBy(combos, (row) => row.comboProductId);
        const componentsByCombo = groupBy(
          components,
          (row) => row.comboGroupId,
        );

        const items: ProductRecord[] = products.map(
          ({ categoryId, productionAreaId, ...product }) => ({
            ...product,
            category: categoryById.get(categoryId)!,
            productionArea: productionAreaId
              ? (areaById.get(productionAreaId) ?? null)
              : null,
            images: (imagesByProduct.get(product.id) ?? []).map(
              ({ productId, ...image }) => {
                void productId;
                return {
                  ...image,
                  file: fileById.get(image.fileId)!,
                };
              },
            ),
            variants: variantsByProduct.get(product.id) ?? [],
            modifierGroups: (linksByProduct.get(product.id) ?? []).map(
              ({ modifierGroupId, sortOrder }) => ({
                sortOrder,
                modifierGroup: modifierById.get(modifierGroupId)!,
              }),
            ),
            comboGroups: (combosByProduct.get(product.id) ?? []).map(
              (group) => ({
                ...group,
                items: (componentsByCombo.get(group.id) ?? []).map(
                  ({ comboGroupId, ...item }) => {
                    void comboGroupId;
                    return item;
                  },
                ),
              }),
            ),
          }),
        );
        return [items, total];
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: await Promise.all(items.map((item) => this.toResponse(item))),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: Math.ceil(total / query.pageSize),
      },
    };
  }

  async menu(query: MenuQueryDto): Promise<MenuResponse> {
    const categories = await this.db.category.findMany({
      where: {
        active: true,
        ...(query.categoryId ? { id: query.categoryId } : {}),
        ...(query.productionAreaId
          ? {
              OR: [
                { productionAreaId: query.productionAreaId },
                {
                  products: {
                    some: { productionAreaId: query.productionAreaId },
                  },
                },
              ],
            }
          : {}),
        products: {
          some: {
            active: true,
            available: true,
            featured: query.featured,
            productionAreaId: query.productionAreaId,
            ...(query.search
              ? { name: { contains: query.search, mode: 'insensitive' } }
              : {}),
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        sortOrder: true,
        products: {
          where: {
            active: true,
            available: true,
            featured: query.featured,
            productionAreaId: query.productionAreaId,
            ...(query.search
              ? { name: { contains: query.search, mode: 'insensitive' } }
              : {}),
          },
          select: PRODUCT_SELECT,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      categories: await Promise.all(
        categories.map(async ({ products, ...category }) => ({
          ...category,
          products: await Promise.all(
            products.map((product) => this.toResponse(product, true)),
          ),
        })),
      ),
    };
  }

  async findOne(params: ProductIdParamDto): Promise<ProductDetailResponse> {
    return this.toResponse(await this.getProduct(params.id));
  }

  async update(
    params: ProductIdParamDto,
    dto: UpdateProductDto,
    actorId: string,
  ): Promise<ProductDetailResponse> {
    this.ensureBody(dto);
    if (dto.categoryId !== undefined || dto.productionAreaId !== undefined) {
      const current = await this.db.product.findUnique({
        where: { id: params.id },
        select: { categoryId: true, productionAreaId: true },
      });
      if (!current) throw new NotFoundException('Producto no encontrado');
      await this.validateProductRelations(
        dto.categoryId ?? current.categoryId,
        dto.productionAreaId === undefined
          ? current.productionAreaId
          : dto.productionAreaId,
      );
    }
    await this.db.$transaction(
      async (tx) => {
        const where = { id: params.id };
        const previous = await tx.product.findUnique({
          where,
          select: { basePrice: true },
        });
        if (!previous) throw new NotFoundException('Producto no encontrado');
        const updated = await tx.product.update({
          where,
          data: dto,
          select: { basePrice: true },
        });
        if (!previous.basePrice.equals(updated.basePrice)) {
          await tx.auditLog.create({
            data: {
              action: 'UPDATE',
              entity: 'Product',
              entityId: params.id,
              userId: actorId,
              description: 'Cambio de precio base',
              oldData: { basePrice: previous.basePrice.toFixed(2) },
              newData: { basePrice: updated.basePrice.toFixed(2) },
            },
          });
        }
      },
      { isolationLevel: 'Serializable' },
    );
    return this.findOne(params);
  }

  async updateStatus(
    params: ProductIdParamDto,
    dto: UpdateProductStatusDto,
  ): Promise<ProductDetailResponse> {
    if (dto.active) {
      const current = await this.db.product.findUnique({
        where: { id: params.id },
        select: { categoryId: true, productionAreaId: true },
      });
      if (!current) throw new NotFoundException('Producto no encontrado');
      await this.validateProductRelations(
        current.categoryId,
        current.productionAreaId,
      );
    }
    const updated = await this.db.product.updateMany({
      where: { id: params.id },
      data: {
        active: dto.active,
        ...(dto.active === false ? { available: false } : {}),
      },
    });
    if (updated.count !== 1)
      throw new NotFoundException('Producto no encontrado');
    return this.findOne(params);
  }

  async updateAvailability(
    params: ProductIdParamDto,
    dto: UpdateAvailabilityDto,
  ): Promise<ProductDetailResponse> {
    if (dto.available) {
      const product = await this.db.product.findUnique({
        where: { id: params.id },
        select: { active: true },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');
      if (!product.active) {
        throw new ConflictException(
          'Un producto inactivo no puede estar disponible',
        );
      }
    }
    const updated = await this.db.product.updateMany({
      where: { id: params.id },
      data: dto,
    });
    if (updated.count !== 1)
      throw new NotFoundException('Producto no encontrado');
    return this.findOne(params);
  }

  async attachImage(
    params: ProductIdParamDto,
    dto: AttachProductImageDto,
  ): Promise<ProductDetailResponse> {
    await this.ensureProductExists(params.id);
    await this.filesService.assertFileType(dto.fileId, FileType.PRODUCT_IMAGE);
    try {
      await this.db.$transaction(async (tx) => {
        const count = await tx.productImage.count({
          where: { productId: params.id },
        });
        const isPrimary = dto.isPrimary ?? count === 0;
        if (isPrimary) {
          await tx.productImage.updateMany({
            where: { productId: params.id },
            data: { isPrimary: false },
          });
        }
        await tx.productImage.create({
          data: { productId: params.id, ...dto, isPrimary },
        });
      });
    } catch (error: unknown) {
      this.rethrowImageConflict(error);
      throw error;
    }
    return this.findOne(params);
  }

  async updateImage(
    params: ProductImageParamDto,
    dto: UpdateProductImageDto,
  ): Promise<ProductDetailResponse> {
    this.ensureBody(dto);
    await this.db.$transaction(async (tx) => {
      const image = await tx.productImage.findUnique({
        where: {
          productId_fileId: { productId: params.id, fileId: params.fileId },
        },
        select: { id: true, isPrimary: true },
      });
      if (!image)
        throw new NotFoundException('Imagen de producto no encontrada');
      if (dto.isPrimary === true) {
        await tx.productImage.updateMany({
          where: { productId: params.id },
          data: { isPrimary: false },
        });
      }
      if (dto.isPrimary === false && image.isPrimary) {
        throw new BadRequestException(
          'Asigne otra imagen principal antes de quitar la actual',
        );
      }
      await tx.productImage.update({ where: { id: image.id }, data: dto });
    });
    return this.findOne({ id: params.id });
  }

  async removeImage(
    params: ProductImageParamDto,
  ): Promise<ProductDetailResponse> {
    await this.db.$transaction(async (tx) => {
      const image = await tx.productImage.findUnique({
        where: {
          productId_fileId: { productId: params.id, fileId: params.fileId },
        },
        select: { id: true, isPrimary: true },
      });
      if (!image)
        throw new NotFoundException('Imagen de producto no encontrada');
      await tx.productImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId: params.id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (next)
          await tx.productImage.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
      }
    });
    return this.findOne({ id: params.id });
  }

  async createVariant(
    params: ProductIdParamDto,
    dto: CreateProductVariantDto,
  ): Promise<ProductVariantResponse> {
    await this.ensureProductExists(params.id);
    try {
      const variant = await this.db.productVariant.create({
        data: { productId: params.id, ...dto },
      });
      return { ...variant, price: variant.price.toString() };
    } catch (error: unknown) {
      this.rethrowVariantConflict(error);
      throw error;
    }
  }

  async updateVariant(
    params: ProductVariantIdParamDto,
    dto: UpdateProductVariantDto,
  ): Promise<ProductVariantResponse> {
    this.ensureBody(dto);
    try {
      const variant = await this.db.productVariant.update({
        where: { id: params.id },
        data: {
          ...dto,
          ...(dto.active === false ? { available: false } : {}),
        },
      });
      return { ...variant, price: variant.price.toString() };
    } catch (error: unknown) {
      this.rethrowNotFound(error, 'Variante no encontrada');
      this.rethrowVariantConflict(error);
      throw error;
    }
  }

  async updateVariantAvailability(
    params: ProductVariantIdParamDto,
    dto: UpdateAvailabilityDto,
  ): Promise<ProductVariantResponse> {
    try {
      if (dto.available) {
        const current = await this.db.productVariant.findUnique({
          where: { id: params.id },
          select: { active: true },
        });
        if (!current) throw new NotFoundException('Variante no encontrada');
        if (!current.active) {
          throw new ConflictException(
            'Una variante inactiva no puede estar disponible',
          );
        }
      }
      const variant = await this.db.productVariant.update({
        where: { id: params.id },
        data: dto,
      });
      return { ...variant, price: variant.price.toString() };
    } catch (error: unknown) {
      this.rethrowNotFound(error, 'Variante no encontrada');
      throw error;
    }
  }

  async setModifierGroups(
    params: ProductIdParamDto,
    dto: SetProductModifierGroupsDto,
  ): Promise<ProductDetailResponse> {
    await this.ensureProductExists(params.id);
    const ids = dto.groups.map((item) => item.modifierGroupId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'No se permiten grupos de modificadores duplicados',
      );
    }
    const count = await this.db.modifierGroup.count({
      where: { id: { in: ids } },
    });
    if (count !== ids.length) {
      throw new NotFoundException(
        'Uno o mas grupos de modificadores no existen',
      );
    }
    await this.db.$transaction(async (tx) => {
      await tx.productModifierGroup.deleteMany({
        where: { productId: params.id },
      });
      if (dto.groups.length) {
        await tx.productModifierGroup.createMany({
          data: dto.groups.map((item) => ({
            productId: params.id,
            modifierGroupId: item.modifierGroupId,
            sortOrder: item.sortOrder ?? 0,
          })),
        });
      }
    });
    return this.findOne(params);
  }

  async removeModifierGroup(
    params: ProductModifierGroupParamDto,
  ): Promise<ProductDetailResponse> {
    const deleted = await this.db.productModifierGroup.deleteMany({
      where: { productId: params.id, modifierGroupId: params.groupId },
    });
    if (deleted.count !== 1) {
      throw new NotFoundException('Asignacion de modificador no encontrada');
    }
    return this.findOne({ id: params.id });
  }

  async createComboGroup(
    params: ProductIdParamDto,
    dto: CreateComboGroupDto,
  ): Promise<ComboGroupResponse> {
    await this.ensureProductExists(params.id);
    this.validateSelection(dto.minSelections ?? 1, dto.maxSelections ?? 1);
    const group = await this.db.comboGroup.create({
      data: { comboProductId: params.id, ...dto },
      include: { items: true },
    });
    return this.toComboGroup(group);
  }

  async updateComboGroup(
    params: ComboGroupIdParamDto,
    dto: UpdateComboGroupDto,
  ): Promise<ComboGroupResponse> {
    this.ensureBody(dto);
    const current = await this.db.comboGroup.findUnique({
      where: { id: params.id },
    });
    if (!current) throw new NotFoundException('Grupo de combo no encontrado');
    this.validateSelection(
      dto.minSelections ?? current.minSelections,
      dto.maxSelections ?? current.maxSelections,
    );
    const group = await this.db.comboGroup.update({
      where: { id: params.id },
      data: dto,
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return this.toComboGroup(group);
  }

  async createComboItem(
    params: ComboGroupIdParamDto,
    dto: CreateComboGroupItemDto,
  ): Promise<ComboGroupResponse> {
    const [group, product] = await Promise.all([
      this.db.comboGroup.findUnique({
        where: { id: params.id },
        select: { id: true, comboProductId: true },
      }),
      this.db.product.findUnique({
        where: { id: dto.productId },
        select: { name: true },
      }),
    ]);
    if (!group) throw new NotFoundException('Grupo de combo no encontrado');
    if (!product)
      throw new NotFoundException('Producto del combo no encontrado');
    if (group.comboProductId === dto.productId) {
      throw new BadRequestException(
        'Un combo no puede incluirse a si mismo como opcion',
      );
    }
    await this.db.comboGroupItem.create({
      data: {
        comboGroupId: params.id,
        ...dto,
        productNameSnapshot: product.name,
      },
    });
    return this.getComboGroup(params.id);
  }

  async updateComboItem(
    params: ComboGroupItemIdParamDto,
    dto: UpdateComboGroupItemDto,
  ): Promise<ComboGroupResponse> {
    this.ensureBody(dto);
    const current = await this.db.comboGroupItem.findUnique({
      where: { id: params.id },
      select: { comboGroupId: true },
    });
    if (!current) throw new NotFoundException('Item de combo no encontrado');
    let productNameSnapshot: string | undefined;
    if (dto.productId) {
      const product = await this.db.product.findUnique({
        where: { id: dto.productId },
        select: { name: true },
      });
      if (!product)
        throw new NotFoundException('Producto del combo no encontrado');
      productNameSnapshot = product.name;
    }
    await this.db.comboGroupItem.update({
      where: { id: params.id },
      data: { ...dto, productNameSnapshot },
    });
    return this.getComboGroup(current.comboGroupId);
  }

  async removeComboItem(
    params: ComboGroupItemIdParamDto,
  ): Promise<MessageResponse> {
    const deleted = await this.db.comboGroupItem.deleteMany({
      where: { id: params.id },
    });
    if (deleted.count !== 1)
      throw new NotFoundException('Item de combo no encontrado');
    return { message: 'Item de combo eliminado correctamente' };
  }

  private async getProduct(id: string): Promise<ProductRecord> {
    const product = await this.db.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private async ensureProductExists(id: string): Promise<void> {
    const product = await this.db.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
  }

  private async validateProductRelations(
    categoryId: string,
    productionAreaId?: string | null,
  ): Promise<void> {
    const [category, area] = await Promise.all([
      this.db.category.findUnique({
        where: { id: categoryId },
        select: { active: true },
      }),
      productionAreaId
        ? this.db.productionArea.findUnique({
            where: { id: productionAreaId },
            select: { active: true },
          })
        : null,
    ]);
    if (!category) throw new NotFoundException('Categoria no encontrada');
    if (!category.active)
      throw new ConflictException('La categoria esta inactiva');
    if (productionAreaId && !area)
      throw new NotFoundException('Area de produccion no encontrada');
    if (area && !area.active)
      throw new ConflictException('El area de produccion esta inactiva');
  }

  private async toResponse(
    product: ProductRecord,
    menuOnlyActive = false,
  ): Promise<ProductDetailResponse> {
    const {
      images,
      variants,
      modifierGroups,
      comboGroups,
      basePrice,
      ...data
    } = product;
    return {
      ...data,
      basePrice: basePrice.toString(),
      images: await Promise.all(
        images.map(async ({ file, ...image }) => ({
          ...image,
          ...file,
          url: await this.filesService.createPresignedUrl(image.fileId),
        })),
      ),
      variants: variants
        .filter((item) => !menuOnlyActive || (item.active && item.available))
        .map((item) => ({ ...item, price: item.price.toString() })),
      modifierGroups: modifierGroups
        .filter((item) => !menuOnlyActive || item.modifierGroup.active)
        .map(({ modifierGroup, sortOrder }) => ({
          ...modifierGroup,
          sortOrder,
          options: modifierGroup.options
            .filter(
              (option) =>
                !menuOnlyActive || (option.active && option.available),
            )
            .map((option) => ({
              ...option,
              priceDelta: option.priceDelta.toString(),
            })),
        })),
      comboGroups: comboGroups.map((group) =>
        this.toComboGroup(group, menuOnlyActive),
      ),
    };
  }

  private async getComboGroup(id: string): Promise<ComboGroupResponse> {
    const group = await this.db.comboGroup.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!group) throw new NotFoundException('Grupo de combo no encontrado');
    return this.toComboGroup(group);
  }

  private toComboGroup(
    group: {
      id: string;
      comboProductId: string;
      name: string;
      minSelections: number;
      maxSelections: number;
      sortOrder: number;
      items: Array<{
        id: string;
        productId: string;
        productNameSnapshot: string;
        additionalPrice: Prisma.Decimal;
        active: boolean;
        sortOrder: number;
      }>;
    },
    menuOnlyActive = false,
  ): ComboGroupResponse {
    return {
      ...group,
      items: group.items
        .filter((item) => !menuOnlyActive || item.active)
        .map((item) => ({
          ...item,
          additionalPrice: item.additionalPrice.toString(),
        })),
    };
  }

  private validateSelection(min: number, max: number): void {
    if (min > max) {
      throw new BadRequestException(
        'minSelections no puede ser mayor que maxSelections',
      );
    }
  }

  private ensureBody(dto: object): void {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
  }

  private rethrowImageConflict(error: unknown): void {
    if (this.isPrismaError(error, 'P2002')) {
      throw new ConflictException('La imagen ya esta asociada al producto');
    }
  }

  private rethrowVariantConflict(error: unknown): void {
    if (this.isPrismaError(error, 'P2002')) {
      throw new ConflictException(
        'Ya existe una variante con ese nombre en el producto',
      );
    }
  }

  private rethrowNotFound(error: unknown, message: string): void {
    if (this.isPrismaError(error, 'P2025'))
      throw new NotFoundException(message);
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}
