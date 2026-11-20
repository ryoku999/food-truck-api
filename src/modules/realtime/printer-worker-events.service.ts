import { Injectable } from '@nestjs/common';
import { PrinterWorkerGateway } from './printer-worker.gateway';

@Injectable()
export class PrinterWorkerEventsService {
  constructor(private readonly gateway: PrinterWorkerGateway) {}

  notifyJobsAvailable(): void {
    // Let the surrounding database transaction commit before agents wake up.
    setTimeout(() => this.gateway.notifyAll(), 0);
  }
}
