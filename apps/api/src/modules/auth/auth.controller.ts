import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';

const COOKIE_NAME = 'memoria_viva_session';
const COOKIE_PATH = '/api/v1';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
type SessionRequest = Request & { user: AuthenticatedUser };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(dto);
    this.setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    this.setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Get('me')
  me(@Req() request: SessionRequest) { return this.auth.profile(request.user.id); }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
    });
    return { loggedOut: true };
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE,
    });
  }
}
