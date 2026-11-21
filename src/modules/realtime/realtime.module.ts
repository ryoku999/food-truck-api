import { Module } from '@nestjs/common';
import { OperationsEventsService } from './operations-events.service';
import { OperationsGateway } from './operations.gateway';
import { PrinterWorkerEventsService } from './printer-worker-events.service';
import { PrinterWorkerGateway } from './printer-worker.gateway';

@Module({
  providers: [
    OperationsGateway,
    OperationsEventsService,
    PrinterWorkerGateway,
    PrinterWorkerEventsService,
  ],
  exports: [OperationsEventsService, PrinterWorkerEventsService],
})
export class RealtimeModule {}
