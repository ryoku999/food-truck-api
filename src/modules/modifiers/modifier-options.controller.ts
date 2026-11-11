import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ModifierOptionIdParamDto } from './dto/modifier-option-id-param.dto';
import { UpdateModifierOptionStatusDto } from './dto/update-modifier-option-status.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';
import { ModifierOptionResponse } from './interfaces/modifier.interface';
import { ModifiersService } from './modifiers.service';

@Controller('modifier-options')
@Auth(UserRole.ADMIN, UserRole.MANAGER)
export class ModifierOptionsController {
  constructor(private readonly modifiersService: ModifiersService) {}

  @Patch(':id')
  update(
    @Param() params: ModifierOptionIdParamDto,
    @Body() dto: UpdateModifierOptionDto,
  ): Promise<ModifierOptionResponse> {
    return this.modifiersService.updateOption(params, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param() params: ModifierOptionIdParamDto,
    @Body() dto: UpdateModifierOptionStatusDto,
  ): Promise<ModifierOptionResponse> {
    return this.modifiersService.updateOptionStatus(params, dto);
  }
}
