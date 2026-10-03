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
import { CreateProductionAreaDto } from './dto/create-production-area.dto';
import { ProductionAreaIdParamDto } from './dto/production-area-id-param.dto';
import { ProductionAreaQueryDto } from './dto/production-area-query.dto';
import { UpdateProductionAreaStatusDto } from './dto/update-production-area-status.dto';
import { UpdateProductionAreaDto } from './dto/update-production-area.dto';
import { ProductionAreaResponse } from './interfaces/production-area.interface';
import { ProductionAreasService } from './production-areas.service';

@Controller('production-areas')
export class ProductionAreasController {
  constructor(
    private readonly productionAreasService: ProductionAreasService,
  ) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(
    @Body() dto: CreateProductionAreaDto,
  ): Promise<ProductionAreaResponse> {
    return this.productionAreasService.create(dto);
  }

  @Get()
  @Auth()
  findAll(
    @Query() query: ProductionAreaQueryDto,
  ): Promise<ProductionAreaResponse[]> {
    return this.productionAreasService.findAll(query);
  }

  @Get(':id')
  @Auth()
  findOne(
    @Param() params: ProductionAreaIdParamDto,
  ): Promise<ProductionAreaResponse> {
    return this.productionAreasService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: ProductionAreaIdParamDto,
    @Body() dto: UpdateProductionAreaDto,
  ): Promise<ProductionAreaResponse> {
    return this.productionAreasService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @Param() params: ProductionAreaIdParamDto,
    @Body() dto: UpdateProductionAreaStatusDto,
  ): Promise<ProductionAreaResponse> {
    return this.productionAreasService.updateStatus(params, dto);
  }
}
