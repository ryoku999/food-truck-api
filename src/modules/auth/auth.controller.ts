import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type Request, type Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { LoginResponse } from './interfaces/auth.interface';
import { AuthService } from './auth.service';
import { AuthCookieService } from './services/auth-cookie.service';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async webLogin(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(body);
    this.authCookieService.setCookies(response, result.tokens);
    return result.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async webLogout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.authCookieService.getRefreshToken(request);
    await this.authService.logout(refreshToken);
    this.authCookieService.clearCookies(response);
    return { message: 'Sesion cerrada correctamente' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async webRefresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.authCookieService.getRefreshToken(request);

    if (!refreshToken) {
      throw new UnauthorizedException('No se encontro el refresh token');
    }

    try {
      const tokens = await this.authService.refresh(refreshToken);
      this.authCookieService.setCookies(response, tokens);
    } catch (error: unknown) {
      this.authCookieService.clearCookies(response);
      throw error;
    }

    return {
      message: 'Token refrescado',
    };
  }

  @Get('me')
  @Auth()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<LoginResponse> {
    return this.authService.getAuthenticatedUser(user.id);
  }
}
