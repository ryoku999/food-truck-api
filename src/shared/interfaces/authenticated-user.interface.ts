import { UserRole } from '@/generated/prisma/enums';

export interface AuthenticatedUser {
  id: string;
  userRole: UserRole;
}
