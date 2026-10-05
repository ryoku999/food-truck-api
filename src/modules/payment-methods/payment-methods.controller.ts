import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodIdParamDto } from './dto/payment-method-id-param.dto';
import { PaymentMethodQueryDto } from './dto/payment-method-query.dto';
import { UpdatePaymentMethodStatusDto } from './dto/update-payment-method-status.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodResponse } from './interfaces/payment-method.interface';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreatePaymentMethodDto): Promise<PaymentMethodResponse> {
    return this.paymentMethodsService.create(dto);
  }

  @Get()
  @Auth()
  findAll(
    @Query() query: PaymentMethodQueryDto,
  ): Promise<PaymentMethodResponse[]> {
    return this.paymentMethodsService.findAll(query);
  }

  @Get(':id')
  @Auth()
  findOne(
    @Param() params: PaymentMethodIdParamDto,
  ): Promise<PaymentMethodResponse> {
    return this.paymentMethodsService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: PaymentMethodIdParamDto,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    return this.paymentMethodsService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @Param() params: PaymentMethodIdParamDto,
    @Body() dto: UpdatePaymentMethodStatusDto,
  ): Promise<PaymentMethodResponse> {
    return this.paymentMethodsService.updateStatus(params, dto);
  }
}
