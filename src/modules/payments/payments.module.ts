import { RealtimeModule } from '@/modules/realtime/realtime.module';
import { Module } from '@nestjs/common';
import { OrderPaymentsController } from './order-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [RealtimeModule],
  controllers: [OrderPaymentsController, PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
