import { RoleCode, UserStatus } from '@/generated/prisma/enums';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  firstName: string;
  lastName: string | null;
  dni: string;
  phone: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: RoleCode;
  status: UserStatus;
}

export interface LoginResponseI {
  tokens: AuthTokens;
  user: AuthUserResponse;
}

export interface LoginRes {
  firstName: string | null;
  id: string;
  lastName: string | null;
  role: string;
  status: string;
  username: string;
}

export interface RegisterResponse {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  dni: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: RoleCode;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
