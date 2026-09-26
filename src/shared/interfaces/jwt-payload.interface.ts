import { RoleCode } from '@/generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  role: RoleCode;
  iat?: number;
  exp?: number;
}
