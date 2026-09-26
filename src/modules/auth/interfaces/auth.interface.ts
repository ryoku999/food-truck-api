import { UserRole, UserStatus } from '@/generated/prisma/enums';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  dni: string;
  userRole: UserRole;
  status: UserStatus;
}

export interface LoginServiceResult {
  tokens: AuthTokens;
  user: AuthUserResponse;
}

export type LoginResponse = AuthUserResponse;
