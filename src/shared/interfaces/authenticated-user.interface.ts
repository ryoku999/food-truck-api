import { RoleCode } from '@/generated/prisma/enums';

export interface AuthenticatedUser {
  id: string;
  role: RoleCode;
}
