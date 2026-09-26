import { DatabaseService } from '@/database/database.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@/generated/prisma/enums';
import {
  durationToMilliseconds,
  generateRefreshToken,
  hashRefreshToken,
} from './utils/auth.utils';
import {
  AuthTokens,
  AuthUserResponse,
  LoginServiceResult,
} from './interfaces/auth.interface';
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

  async login(dto: LoginDto): Promise<LoginServiceResult> {
    const userFound = await this.db.user.findUnique({
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
      userFound.userRole,
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
        dni: userFound.dni,
        firstName: userFound.firstName,
        lastName: userFound.lastName,
        userRole: userFound.userRole,
        status: userFound.status,
      },
    };
  }

  private async createTokensResponse(
    userId: string,
    userRole: UserRole,
    refreshToken = generateRefreshToken(),
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, userRole };
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
      storedToken.user.userRole,
      nextRefreshToken,
    );
  }

  async getAuthenticatedUser(userId: string): Promise<AuthUserResponse> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        dni: true,
        firstName: true,
        lastName: true,
        userRole: true,
        status: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no esta activa');
    }

    return user;
  }
}
