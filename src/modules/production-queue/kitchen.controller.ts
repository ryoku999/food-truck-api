import { UserRole, ProductionAreaCode } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ProductionItemIdParamDto,
  ProductionQueueQueryDto,
  UpdatePreparationStatusDto,
} from './dto/production-queue.dto';
import {
  PaginatedProductionQueueResponse,
  ProductionQueueItemResponse,
} from './interfaces/production-queue.interface';
import { ProductionQueueService } from './production-queue.service';

@Controller('kitchen')
@Auth(UserRole.KITCHEN, UserRole.ADMIN, UserRole.MANAGER)
export class KitchenController {
  constructor(
    private readonly productionQueueService: ProductionQueueService,
  ) {}

  @Get('items')
  findAll(
    @Query() query: ProductionQueueQueryDto,
  ): Promise<PaginatedProductionQueueResponse> {
    return this.productionQueueService.findQueue(
      ProductionAreaCode.KITCHEN,
      query,
    );
  }

  @Patch('items/:id/status')
  updateStatus(
    @Param() params: ProductionItemIdParamDto,
    @Body() dto: UpdatePreparationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProductionQueueItemResponse> {
    return this.productionQueueService.updateStatus(
      ProductionAreaCode.KITCHEN,
      params,
      dto,
      user,
    );
  }
}
