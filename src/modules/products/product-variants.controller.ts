import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { Body, Controller, Param, Patch } from '@nestjs/common';
import { UpdateAvailabilityDto } from './dto/product.dto';
import { ProductVariantIdParamDto } from './dto/product-params.dto';
import { UpdateProductVariantDto } from './dto/product-relations.dto';
import { ProductVariantResponse } from './interfaces/product.interface';
import { ProductsService } from './products.service';

@Controller('product-variants')
@Auth(UserRole.ADMIN, UserRole.MANAGER)
export class ProductVariantsController {
  constructor(private readonly productsService: ProductsService) {}

  @Patch(':id')
  update(
    @Param() params: ProductVariantIdParamDto,
    @Body() dto: UpdateProductVariantDto,
  ): Promise<ProductVariantResponse> {
    return this.productsService.updateVariant(params, dto);
  }

  @Patch(':id/availability')
  updateAvailability(
    @Param() params: ProductVariantIdParamDto,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<ProductVariantResponse> {
    return this.productsService.updateVariantAvailability(params, dto);
  }
}
