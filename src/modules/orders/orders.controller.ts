import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { OrdersService } from './orders.service';

const OPERATIONAL_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
  UserRole.BAR,
];

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.create(dto, user);
  }

  @Get()
  @Auth(...OPERATIONAL_ROLES)
  findAll(
    @Query() query: OrderQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedOrdersResponse> {
    return this.ordersService.findAll(
      user.userRole === UserRole.WAITER
        ? { ...query, createdById: user.id }
        : query,
    );
  }

  @Get(':id')
  @Auth(...OPERATIONAL_ROLES)
  findOne(@Param() params: OrderIdParamDto): Promise<OrderDetailResponse> {
    return this.ordersService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: OrderIdParamDto,
    @Body() dto: UpdateDraftOrderDto,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.update(params, dto);
  }

  @Post(':id/tables')
  @Auth(UserRole.WAITER, UserRole.CASHIER, UserRole.ADMIN, UserRole.MANAGER)
  setTables(
    @Param() params: OrderIdParamDto,
    @Body() dto: SetOrderTablesDto,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.setTables(params, dto);
  }

  @Post(':id/send')
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  send(
    @Param() params: OrderIdParamDto,
    @Body() dto: SendOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.send(params, dto, user);
  }

  @Post(':id/cancel')
  @Auth(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  cancel(
    @Param() params: OrderIdParamDto,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.cancel(params, dto, user);
  }

  @Get(':id/summary')
  @Auth(UserRole.CASHIER, UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  summary(@Param() params: OrderIdParamDto): Promise<OrderSummaryResponse> {
    return this.ordersService.summary(params);
  }

  @Post(':id/items')
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  addItem(
    @Param() params: OrderIdParamDto,
    @Body() dto: AddOrderItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.addItem(params, dto, user);
  }

  @Patch(':id/items/:itemId')
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  updateItem(
    @Param() params: OrderItemParamDto,
    @Body() dto: UpdateDraftOrderItemDto,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.updateItem(params, dto);
  }

  @Delete(':id/items/:itemId')
  @Auth(UserRole.WAITER, UserRole.ADMIN, UserRole.MANAGER)
  removeItem(@Param() params: OrderItemParamDto): Promise<OrderDetailResponse> {
    return this.ordersService.removeItem(params);
  }

  @Post(':id/items/:itemId/cancel')
  @Auth(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  cancelItem(
    @Param() params: OrderItemParamDto,
    @Body() dto: CancelOrderItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailResponse> {
    return this.ordersService.cancelItem(params, dto, user);
  }
}
