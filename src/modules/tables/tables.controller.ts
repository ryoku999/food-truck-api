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
import { CreateTableDto } from './dto/create-table.dto';
import { TableIdParamDto } from './dto/table-id-param.dto';
import { TableMapQueryDto } from './dto/table-map-query.dto';
import { TableQueryDto } from './dto/table-query.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import {
  TableDetailResponse,
  TableMapResponse,
  TableResponse,
} from './interfaces/table.interface';
import { TablesService } from './tables.service';

@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateTableDto): Promise<TableResponse> {
    return this.tablesService.create(dto);
  }

  @Get()
  @Auth()
  findAll(@Query() query: TableQueryDto): Promise<TableResponse[]> {
    return this.tablesService.findAll(query);
  }

  @Get('map')
  @Auth()
  getMap(@Query() query: TableMapQueryDto): Promise<TableMapResponse> {
    return this.tablesService.getMap(query);
  }

  @Get(':id')
  @Auth()
  findOne(@Param() params: TableIdParamDto): Promise<TableDetailResponse> {
    return this.tablesService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: TableIdParamDto,
    @Body() dto: UpdateTableDto,
  ): Promise<TableDetailResponse> {
    return this.tablesService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  updateStatus(
    @Param() params: TableIdParamDto,
    @Body() dto: UpdateTableStatusDto,
  ): Promise<TableDetailResponse> {
    return this.tablesService.updateStatus(params, dto);
  }
}
