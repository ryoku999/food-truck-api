import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CancelPaymentDto, PaymentIdParamDto } from './dto/payment.dto';
import { PaymentResponse } from './interfaces/payment.interface';
import { PaymentsService } from './payments.service';

@Controller('payments')
@Auth(UserRole.ADMIN, UserRole.MANAGER)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':id/cancel')
  cancel(
    @Param() params: PaymentIdParamDto,
    @Body() dto: CancelPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    return this.paymentsService.cancel(params, dto, user);
  }
}
