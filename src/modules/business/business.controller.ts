import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { SetBusinessLogoDto } from './dto/set-business-logo.dto';
import { UpsertBusinessDto } from './dto/upsert-business.dto';
import { BusinessService } from './business.service';
import { BusinessResponse } from './interfaces/business.interface';

@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Get()
  @Auth()
  findSettings(): Promise<BusinessResponse> {
    return this.businessService.findSettings();
  }

  @Put()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  upsert(
    @Body() dto: UpsertBusinessDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BusinessResponse> {
    return this.businessService.upsert(dto, actor.id);
  }

  @Put('logo')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  setLogo(
    @Body() dto: SetBusinessLogoDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BusinessResponse> {
    return this.businessService.setLogo(dto, actor.id);
  }

  @Delete('logo')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  removeLogo(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BusinessResponse> {
    return this.businessService.removeLogo(actor.id);
  }
}
