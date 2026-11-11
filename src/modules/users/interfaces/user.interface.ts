import { UserRole, UserStatus } from '@/generated/prisma/enums';

export interface UserResponse {
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

export interface PaginatedUsersResponse {
  items: UserResponse[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface MessageResponse {
  message: string;
}

export type CreateUserResponse = UserResponse;
