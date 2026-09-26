import { UserRole, UserStatus } from '@/generated/prisma/enums';

export interface CreateUserResponse {
  id: string;
  username: string;
  dni: string;
  firstName: string | null;
  lastName: string | null;
  userRole: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
