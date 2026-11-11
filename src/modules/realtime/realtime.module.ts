import { Module } from '@nestjs/common';
import { OperationsEventsService } from './operations-events.service';
import { OperationsGateway } from './operations.gateway';

@Module({
  providers: [OperationsGateway, OperationsEventsService],
  exports: [OperationsEventsService],
})
export class RealtimeModule {}
