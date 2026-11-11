import { UserRole } from '@/generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  userRole: UserRole;
  iat?: number;
  exp?: number;
}
