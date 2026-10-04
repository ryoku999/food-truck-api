import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ComboGroupIdParamDto,
  ComboGroupItemIdParamDto,
} from './dto/product-params.dto';
import {
  CreateComboGroupItemDto,
  UpdateComboGroupDto,
  UpdateComboGroupItemDto,
} from './dto/product-relations.dto';
import {
  ComboGroupResponse,
  MessageResponse,
} from './interfaces/product.interface';
import { ProductsService } from './products.service';

@Auth(UserRole.ADMIN, UserRole.MANAGER)
@Controller()
export class ComboGroupsController {
  constructor(private readonly productsService: ProductsService) {}

  @Patch('combo-groups/:id')
  updateGroup(
    @Param() params: ComboGroupIdParamDto,
    @Body() dto: UpdateComboGroupDto,
  ): Promise<ComboGroupResponse> {
    return this.productsService.updateComboGroup(params, dto);
  }

  @Post('combo-groups/:id/items')
  createItem(
    @Param() params: ComboGroupIdParamDto,
    @Body() dto: CreateComboGroupItemDto,
  ): Promise<ComboGroupResponse> {
    return this.productsService.createComboItem(params, dto);
  }

  @Patch('combo-group-items/:id')
  updateItem(
    @Param() params: ComboGroupItemIdParamDto,
    @Body() dto: UpdateComboGroupItemDto,
  ): Promise<ComboGroupResponse> {
    return this.productsService.updateComboItem(params, dto);
  }

  @Delete('combo-group-items/:id')
  removeItem(
    @Param() params: ComboGroupItemIdParamDto,
  ): Promise<MessageResponse> {
    return this.productsService.removeComboItem(params);
  }
}
