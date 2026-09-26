import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { RoleGuard } from '../guards/role.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RoleCode } from '@/generated/prisma/enums';
import { ROLES_KEY } from '../constants/roles-key.constant';

export function Auth(...roles: RoleCode[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(JwtAuthGuard, RoleGuard),
  );
}
