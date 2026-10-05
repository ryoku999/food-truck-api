import { Module } from '@nestjs/common';
import { BarController } from './bar.controller';
import { KitchenController } from './kitchen.controller';
import { ProductionQueueService } from './production-queue.service';

@Module({
  controllers: [KitchenController, BarController],
  providers: [ProductionQueueService],
  exports: [ProductionQueueService],
})
export class ProductionQueueModule {}
