import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashRegistersService } from './cash-registers.service';
import {
  CashSessionIdParamDto,
  CloseCashSessionDto,
  CreateCashMovementDto,
  CurrentCashSessionQueryDto,
  OpenCashSessionDto,
} from './dto/cash-register.dto';
import {
  CashMovementResponse,
  CashSessionResponse,
} from './interfaces/cash-register.interface';

@Controller('cash-sessions')
@Auth(UserRole.CASHIER, UserRole.ADMIN, UserRole.MANAGER)
export class CashSessionsController {
  constructor(private readonly service: CashRegistersService) {}

  @Post('open')
  open(
    @Body() dto: OpenCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionResponse> {
    return this.service.openSession(dto, user);
  }

  @Get('current')
  current(
    @Query() query: CurrentCashSessionQueryDto,
  ): Promise<CashSessionResponse> {
    return this.service.findCurrentSession(query);
  }

  @Get(':id')
  findOne(
    @Param() params: CashSessionIdParamDto,
  ): Promise<CashSessionResponse> {
    return this.service.findSession(params);
  }

  @Post(':id/movements')
  createMovement(
    @Param() params: CashSessionIdParamDto,
    @Body() dto: CreateCashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashMovementResponse> {
    return this.service.createMovement(params, dto, user);
  }

  @Post(':id/close')
  close(
    @Param() params: CashSessionIdParamDto,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashSessionResponse> {
    return this.service.closeSession(params, dto, user);
  }
}
