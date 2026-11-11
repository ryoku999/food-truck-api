import { DatabaseService } from '@/database/database.service';
import { UserRole, UserStatus } from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import type { JwtPayload } from '@/shared/interfaces/jwt-payload.interface';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

interface OperationsServerEvents {
  'operations.ready': (payload: {
    occurredAt: string;
    data: { userRole: UserRole };
  }) => void;
  'operations.error': (payload: {
    occurredAt: string;
    data: { message: string };
  }) => void;
}

export type OperationsSocket = Socket<
  Record<string, never>,
  OperationsServerEvents,
  Record<string, never>,
  { user?: AuthenticatedUser }
>;

@WebSocketGateway({ namespace: '/operations' })
export class OperationsGateway implements OnGatewayConnection {
  private readonly accessCookieName: string;
  private readonly jwtSecret: string;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.accessCookieName = configService.getOrThrow<string>(
      'AUTH_ACCESS_COOKIE_NAME',
    );
    this.jwtSecret = configService.getOrThrow<string>('JWT_SECRET');
    this.jwtIssuer = configService.getOrThrow<string>('JWT_ISSUER');
    this.jwtAudience = configService.getOrThrow<string>('JWT_AUDIENCE');
  }

  async handleConnection(client: OperationsSocket): Promise<void> {
    try {
      const token = this.readCookie(
        client.handshake.headers.cookie,
        this.accessCookieName,
      );
      if (!token) throw new Error('Cookie de acceso ausente');

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.jwtSecret,
        issuer: this.jwtIssuer,
        audience: this.jwtAudience,
        algorithms: ['HS256'],
      });
      const user = await this.db.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, userRole: true, status: true },
      });
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new Error('Usuario inactivo o inexistente');
      }

      client.data.user = { id: user.id, userRole: user.userRole };
      await client.join([`user:${user.id}`, `role:${user.userRole}`]);
      if (
        user.userRole === UserRole.KITCHEN ||
        user.userRole === UserRole.ADMIN ||
        user.userRole === UserRole.MANAGER
      ) {
        await client.join('area:KITCHEN');
      }
      if (
        user.userRole === UserRole.BAR ||
        user.userRole === UserRole.ADMIN ||
        user.userRole === UserRole.MANAGER
      ) {
        await client.join('area:BAR');
      }
      client.emit('operations.ready', {
        occurredAt: new Date().toISOString(),
        data: { userRole: user.userRole },
      });
    } catch {
      client.emit('operations.error', {
        occurredAt: new Date().toISOString(),
        data: { message: 'No autorizado' },
      });
      client.disconnect(true);
    }
  }

  private readCookie(
    cookieHeader: string | undefined,
    cookieName: string,
  ): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const name = part.slice(0, separator).trim();
      if (name !== cookieName) continue;
      const value = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
    return null;
  }
}
