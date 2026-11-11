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
import { CreateDiningAreaDto } from './dto/create-dining-area.dto';
import { DiningAreaIdParamDto } from './dto/dining-area-id-param.dto';
import { DiningAreaQueryDto } from './dto/dining-area-query.dto';
import { UpdateDiningAreaStatusDto } from './dto/update-dining-area-status.dto';
import { UpdateDiningAreaDto } from './dto/update-dining-area.dto';
import { DiningAreasService } from './dining-areas.service';
import {
  DiningAreaDetailResponse,
  DiningAreaResponse,
} from './interfaces/dining-area.interface';

@Controller('dining-areas')
export class DiningAreasController {
  constructor(private readonly diningAreasService: DiningAreasService) {}

  @Post()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateDiningAreaDto): Promise<DiningAreaResponse> {
    return this.diningAreasService.create(dto);
  }

  @Get()
  @Auth()
  findAll(@Query() query: DiningAreaQueryDto): Promise<DiningAreaResponse[]> {
    return this.diningAreasService.findAll(query);
  }

  @Get(':id')
  @Auth()
  findOne(
    @Param() params: DiningAreaIdParamDto,
  ): Promise<DiningAreaDetailResponse> {
    return this.diningAreasService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @Param() params: DiningAreaIdParamDto,
    @Body() dto: UpdateDiningAreaDto,
  ): Promise<DiningAreaDetailResponse> {
    return this.diningAreasService.update(params, dto);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @Param() params: DiningAreaIdParamDto,
    @Body() dto: UpdateDiningAreaStatusDto,
  ): Promise<DiningAreaDetailResponse> {
    return this.diningAreasService.updateStatus(params, dto);
  }
}
