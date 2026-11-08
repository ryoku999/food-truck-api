import { Auth } from '@/shared/decorators/auth.decorator';
import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { AuditLogIdDto, AuditLogQueryDto } from './audit-logs.dto';
import { AuditLogsService } from './audit-logs.service';

@Controller('audit-logs')
@Auth('ADMIN', 'MANAGER')
class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  list(@Query() query: AuditLogQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param() params: AuditLogIdDto) {
    return this.service.detail(params.id);
  }
}

@Module({ controllers: [AuditLogsController], providers: [AuditLogsService] })
export class AuditLogsModule {}
