import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateProductDto,
  MenuQueryDto,
  ProductAdminQueryDto,
  UpdateAvailabilityDto,
  UpdateProductDto,
  UpdateProductStatusDto,
} from './dto/product.dto';
import {
  ProductIdParamDto,
  ProductImageParamDto,
  ProductModifierGroupParamDto,
} from './dto/product-params.dto';
import {
  AttachProductImageDto,
  CreateComboGroupDto,
  CreateProductVariantDto,
  SetProductModifierGroupsDto,
  UpdateProductImageDto,
} from './dto/product-relations.dto';
import {
  ComboGroupResponse,
  MenuResponse,
  PaginatedProductsResponse,
  ProductDetailResponse,
  ProductVariantResponse,
} from './interfaces/product.interface';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateProductDto): Promise<ProductDetailResponse> {
    return this.productsService.create(dto);
  }

  @Get()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  findAll(
    @Query() query: ProductAdminQueryDto,
  ): Promise<PaginatedProductsResponse> {
    return this.productsService.findAll(query);
  }

  @Get('menu')
  @Auth()
  menu(@Query() query: MenuQueryDto): Promise<MenuResponse> {
    return this.productsService.menu(query);
  }

  @Get(':id')
  @Auth()
  findOne(@Param() params: ProductIdParamDto): Promise<ProductDetailResponse> {
    return this.productsService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateProductStatusDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.updateStatus(params, dto);
  }

  @Patch(':id/availability')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateAvailability(
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.updateAvailability(params, dto);
  }

  @Post(':id/images')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  attachImage(
    @Param() params: ProductIdParamDto,
    @Body() dto: AttachProductImageDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.attachImage(params, dto);
  }

  @Patch(':id/images/:fileId')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateImage(
    @Param() params: ProductImageParamDto,
    @Body() dto: UpdateProductImageDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.updateImage(params, dto);
  }

  @Delete(':id/images/:fileId')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  removeImage(
    @Param() params: ProductImageParamDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.removeImage(params);
  }

  @Post(':id/variants')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  createVariant(
    @Param() params: ProductIdParamDto,
    @Body() dto: CreateProductVariantDto,
  ): Promise<ProductVariantResponse> {
    return this.productsService.createVariant(params, dto);
  }

  @Put(':id/modifier-groups')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  setModifierGroups(
    @Param() params: ProductIdParamDto,
    @Body() dto: SetProductModifierGroupsDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.setModifierGroups(params, dto);
  }

  @Delete(':id/modifier-groups/:groupId')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  removeModifierGroup(
    @Param() params: ProductModifierGroupParamDto,
  ): Promise<ProductDetailResponse> {
    return this.productsService.removeModifierGroup(params);
  }

  @Post(':id/combo-groups')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  createComboGroup(
    @Param() params: ProductIdParamDto,
    @Body() dto: CreateComboGroupDto,
  ): Promise<ComboGroupResponse> {
    return this.productsService.createComboGroup(params, dto);
  }
}
