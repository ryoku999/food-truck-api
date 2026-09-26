import { DatabaseService } from '@/database/database.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import bcrypt from 'bcryptjs';
import { RoleCode, UserStatus } from '@/generated/prisma/enums';
import {
  durationToMilliseconds,
  generateRefreshToken,
  hashRefreshToken,
} from './utils/auth.utils';
import { AuthTokens } from './interfaces/auth.interface';
import { JwtPayload } from '@/shared/interfaces/jwt-payload.interface';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly refreshExpiresInMs: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.refreshExpiresInMs = durationToMilliseconds(
      configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
  }

  async login(dto: LoginDto) {
    const userFound = await this.db.user.findFirst({
      where: { username: dto.username },
    });

    if (!userFound) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const passwordIsValid = await bcrypt.compare(
      dto.password,
      userFound.password,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    if (userFound.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no esta activa');
    }

    const tokens = await this.createTokensResponse(
      userFound.id,
      userFound.role,
    );

    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresInMs);

    await this.db.refreshToken.create({
      data: {
        userId: userFound.id,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      tokens,
      user: {
        id: userFound.id,
        username: userFound.username,
        firstName: userFound.firstName,
        lastName: userFound.lastName,
        role: userFound.role,
        status: userFound.status,
      },
    };
  }

  private async createTokensResponse(
    userId: string,
    role: RoleCode,
    refreshToken = generateRefreshToken(),
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, role };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      refreshToken,
    };
  }

  async logout(rawRefreshToken: string | null): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    await this.db.refreshToken.deleteMany({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    });
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const storedToken = await this.db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('El refresh token no es valido');
    }

    if (storedToken.expiresAt <= new Date()) {
      await this.db.refreshToken.deleteMany({
        where: { id: storedToken.id },
      });

      throw new UnauthorizedException('El refresh token ha expirado');
    }

    if (storedToken.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no esta activa');
    }

    const nextRefreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresInMs);

    await this.db.$transaction(async (transaction) => {
      const deleted = await transaction.refreshToken.deleteMany({
        where: { id: storedToken.id },
      });

      if (deleted.count !== 1) {
        throw new UnauthorizedException('El refresh token no es valido');
      }

      await transaction.refreshToken.create({
        data: {
          userId: storedToken.userId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          expiresAt: refreshExpiresAt,
        },
      });
    });

    return this.createTokensResponse(
      storedToken.userId,
      storedToken.user.role,
      nextRefreshToken,
    );
  }
}
