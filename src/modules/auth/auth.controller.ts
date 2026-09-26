import {
  Body,
  Controller,
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
import { LoginRes } from './interfaces/auth.interface';
import { AuthService } from './auth.service';
import { AuthCookieService } from './services/auth-cookie.service';

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
  ): Promise<LoginRes> {
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

    const tokens = await this.authService.refresh(refreshToken);
    this.authCookieService.setCookies(response, tokens);

    return {
      message: 'Token refrescado',
    };
  }
}
