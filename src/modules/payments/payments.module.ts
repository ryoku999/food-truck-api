import { RealtimeModule } from '@/modules/realtime/realtime.module';
import { Module } from '@nestjs/common';
import { OrderPaymentsController } from './order-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { BillPartsService } from './bill-parts.service';
import { BillPartsController } from './bill-parts.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [
    OrderPaymentsController,
    PaymentsController,
    BillPartsController,
  ],
  providers: [PaymentsService, BillPartsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
