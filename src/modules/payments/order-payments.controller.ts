import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreatePaymentDto, PaymentOrderIdParamDto } from './dto/payment.dto';
import {
  OrderPaymentsResponse,
  PaymentResponse,
} from './interfaces/payment.interface';
import { PaymentsService } from './payments.service';

@Controller('orders/:id/payments')
@Auth(UserRole.CASHIER, UserRole.ADMIN, UserRole.MANAGER)
export class OrderPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(
    @Param() params: PaymentOrderIdParamDto,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    return this.paymentsService.create(params, dto, user);
  }

  @Get()
  findAll(
    @Param() params: PaymentOrderIdParamDto,
  ): Promise<OrderPaymentsResponse> {
    return this.paymentsService.findAll(params);
  }
}
