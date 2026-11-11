import { Auth } from '@/shared/decorators/auth.decorator';
import { Controller, Get, Module, Query } from '@nestjs/common';
import {
  CashSessionsReportDto,
  ProductsReportDto,
  ReportRangeDto,
  SalesReportDto,
} from './reports.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Auth('ADMIN', 'MANAGER')
class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('dashboard')
  dashboard(@Query() query: ReportRangeDto) {
    return this.service.dashboard(query);
  }

  @Get('sales')
  sales(@Query() query: SalesReportDto) {
    return this.service.sales(query);
  }

  @Get('products')
  products(@Query() query: ProductsReportDto) {
    return this.service.products(query);
  }

  @Get('waiters')
  waiters(@Query() query: ReportRangeDto) {
    return this.service.waiters(query);
  }

  @Get('payment-methods')
  paymentMethods(@Query() query: ReportRangeDto) {
    return this.service.paymentMethods(query);
  }

  @Get('cash-sessions')
  cashSessions(@Query() query: CashSessionsReportDto) {
    return this.service.cashSessions(query);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
