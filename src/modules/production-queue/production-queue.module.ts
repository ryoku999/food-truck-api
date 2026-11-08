import { Module } from '@nestjs/common';
import { RealtimeModule } from '@/modules/realtime/realtime.module';
import { BarController } from './bar.controller';
import { KitchenController } from './kitchen.controller';
import { ProductionQueueService } from './production-queue.service';

@Module({
  imports: [RealtimeModule],
  controllers: [KitchenController, BarController],
  providers: [ProductionQueueService],
  exports: [ProductionQueueService],
})
export class ProductionQueueModule {}
