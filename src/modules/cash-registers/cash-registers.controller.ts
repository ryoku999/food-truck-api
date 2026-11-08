import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CashRegistersService } from './cash-registers.service';
import {
  CashRegisterIdParamDto,
  CashRegisterQueryDto,
  CreateCashRegisterDto,
  UpdateCashRegisterDto,
} from './dto/cash-register.dto';
import { CashRegisterResponse } from './interfaces/cash-register.interface';

@Controller('cash-registers')
export class CashRegistersController {
  constructor(private readonly service: CashRegistersService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateCashRegisterDto): Promise<CashRegisterResponse> {
    return this.service.createRegister(dto);
  }

  @Get()
  @Auth(UserRole.CASHIER, UserRole.ADMIN, UserRole.MANAGER)
  findAll(
    @Query() query: CashRegisterQueryDto,
  ): Promise<CashRegisterResponse[]> {
    return this.service.findAllRegisters(query);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: CashRegisterIdParamDto,
    @Body() dto: UpdateCashRegisterDto,
  ): Promise<CashRegisterResponse> {
    return this.service.updateRegister(params, dto);
  }
}
