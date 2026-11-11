import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { AUTH_ERROR, authUnauthorized } from '../errors/auth-errors';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    error: unknown,
    user: TUser | false | null,
    info?: Error,
  ): TUser {
    if (error instanceof Error) {
      throw error;
    }

    if (info?.name === 'TokenExpiredError') {
      throw authUnauthorized(
        AUTH_ERROR.ACCESS_TOKEN_EXPIRED,
        'El token de acceso ha expirado',
      );
    }

    if (user) {
      return user;
    }

    if (info?.message === 'No auth token') {
      throw new UnauthorizedException('Se requiere autenticacion');
    }

    throw authUnauthorized(
      AUTH_ERROR.ACCESS_TOKEN_INVALID,
      'El token de acceso no es valido',
    );
  }
}
