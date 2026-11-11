import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import {
  AgentCreateDto,
  AgentUpdateDto,
  IdDto,
  JobQueryDto,
  PrinterCreateDto,
  PrinterQueryDto,
  PrinterUpdateDto,
  PrintResultDto,
  PrintTicketDto,
  PrintPrebillDto,
  PartTicketParamsDto,
  TestPrinterDto,
} from './printing.dto';
import { PrintingService } from './printing.service';

@Controller()
class PrintingController {
  constructor(private readonly service: PrintingService) {}

  @Get('printers')
  @Auth('ADMIN', 'MANAGER')
  printers(@Query() query: PrinterQueryDto) {
    return this.service.printers(query);
  }

  @Post('printers')
  @Auth('ADMIN', 'MANAGER')
  createPrinter(@Body() dto: PrinterCreateDto) {
    return this.service.savePrinter(dto);
  }

  @Patch('printers/:id')
  @Auth('ADMIN', 'MANAGER')
  updatePrinter(@Param() { id }: IdDto, @Body() dto: PrinterUpdateDto) {
    return this.service.savePrinter(dto, id);
  }

  @Post('printers/:id/test')
  @Auth('ADMIN', 'MANAGER')
  test(
    @Param() { id }: IdDto,
    @Body() dto: TestPrinterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueue(id, user.id, undefined, dto.message);
  }

  @Get('printer-agents')
  @Auth('ADMIN', 'MANAGER')
  agents() {
    return this.service.agents();
  }

  @Post('printer-agents')
  @Auth('ADMIN')
  createAgent(@Body() dto: AgentCreateDto) {
    return this.service.createAgent(dto);
  }

  @Patch('printer-agents/:id')
  @Auth('ADMIN')
  updateAgent(@Param() { id }: IdDto, @Body() dto: AgentUpdateDto) {
    return this.service.updateAgent(id, dto);
  }

  @Post('printer-agents/:id/rotate-token')
  @Auth('ADMIN')
  rotate(@Param() { id }: IdDto) {
    return this.service.rotate(id);
  }

  @Get('print-jobs')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  jobs(@Query() query: JobQueryDto) {
    return this.service.jobs(query);
  }

  @Get('print-jobs/:id')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  job(@Param() { id }: IdDto) {
    return this.service.job(id);
  }

  @Post('print-jobs/:id/retry')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  retry(@Param() { id }: IdDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.retry(id, user.id);
  }

  @Post('orders/:id/print-prebill')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  prebill(
    @Param() { id }: IdDto,
    @Body() dto: PrintPrebillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueuePrebill(id, dto.printerId, user.id, dto.copyId);
  }

  @Post('orders/:id/print-ticket')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  ticket(
    @Param() { id }: IdDto,
    @Body() dto: PrintTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueue(dto.printerId, user.id, id);
  }

  @Post('payments/:id/print-receipt')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  receipt(
    @Param() { id }: IdDto,
    @Body() dto: PrintTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueueReceipt(id, dto.printerId, user.id);
  }

  @Post('orders/:id/bill-parts/:partId/print-ticket')
  @Auth('CASHIER', 'ADMIN', 'MANAGER')
  partTicket(
    @Param() { id, partId }: PartTicketParamsDto,
    @Body() dto: PrintTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.enqueuePartTicket(id, partId, dto.printerId, user.id);
  }
}

@Controller('printer-worker')
class PrinterWorkerController {
  constructor(private readonly service: PrintingService) {}

  @Post('claim')
  claim(@Headers('authorization') header?: string) {
    return this.service.claim(header);
  }

  @Post('jobs/:id/result')
  result(
    @Param() { id }: IdDto,
    @Body() dto: PrintResultDto,
    @Headers('authorization') header?: string,
  ) {
    return this.service.result(id, dto, header);
  }
}

@Module({
  controllers: [PrintingController, PrinterWorkerController],
  providers: [PrintingService],
})
export class PrintingModule {}
