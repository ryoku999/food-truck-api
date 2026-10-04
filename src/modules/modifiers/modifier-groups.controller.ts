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
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { ModifierGroupIdParamDto } from './dto/modifier-group-id-param.dto';
import { ModifierGroupQueryDto } from './dto/modifier-group-query.dto';
import { UpdateModifierGroupStatusDto } from './dto/update-modifier-group-status.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import {
  ModifierGroupResponse,
  ModifierOptionResponse,
} from './interfaces/modifier.interface';
import { ModifiersService } from './modifiers.service';

@Controller('modifier-groups')
@Auth(UserRole.ADMIN, UserRole.MANAGER)
export class ModifierGroupsController {
  constructor(private readonly modifiersService: ModifiersService) {}

  @Post()
  create(@Body() dto: CreateModifierGroupDto): Promise<ModifierGroupResponse> {
    return this.modifiersService.createGroup(dto);
  }

  @Get()
  findAll(
    @Query() query: ModifierGroupQueryDto,
  ): Promise<ModifierGroupResponse[]> {
    return this.modifiersService.findAllGroups(query);
  }

  @Get(':id')
  findOne(
    @Param() params: ModifierGroupIdParamDto,
  ): Promise<ModifierGroupResponse> {
    return this.modifiersService.findOneGroup(params);
  }

  @Patch(':id')
  update(
    @Param() params: ModifierGroupIdParamDto,
    @Body() dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroupResponse> {
    return this.modifiersService.updateGroup(params, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param() params: ModifierGroupIdParamDto,
    @Body() dto: UpdateModifierGroupStatusDto,
  ): Promise<ModifierGroupResponse> {
    return this.modifiersService.updateGroupStatus(params, dto);
  }

  @Post(':id/options')
  createOption(
    @Param() params: ModifierGroupIdParamDto,
    @Body() dto: CreateModifierOptionDto,
  ): Promise<ModifierOptionResponse> {
    return this.modifiersService.createOption(params, dto);
  }
}
