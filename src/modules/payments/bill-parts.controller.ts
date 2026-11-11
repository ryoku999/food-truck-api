import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BillPartsService } from './bill-parts.service';
import {
  BillPartIdParamDto,
  CreateBillPartDto,
  PaymentOrderIdParamDto,
} from './dto/payment.dto';

@Controller('orders/:id/bill-parts')
@Auth('CASHIER', 'ADMIN', 'MANAGER')
export class BillPartsController {
  constructor(private readonly parts: BillPartsService) {}

  @Get()
  list(@Param() { id }: PaymentOrderIdParamDto) {
    return this.parts.list(id);
  }

  @Post()
  create(
    @Param() { id }: PaymentOrderIdParamDto,
    @Body() dto: CreateBillPartDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parts.create(id, dto, user.id);
  }

  @Delete(':partId')
  remove(
    @Param() { id, partId }: BillPartIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parts.remove(id, partId, user.id);
  }
}
