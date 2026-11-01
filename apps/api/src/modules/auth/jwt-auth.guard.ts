import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AuthenticatedUser } from './auth.types.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

type AuthRequest = Request & { user?: AuthenticatedUser };
const COOKIE_NAME = 'memoria_viva_session';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.cookieToken(request) ?? this.bearerToken(request);
    const user = token ? this.auth.verifyToken(token) : null;
    if (!user) throw new UnauthorizedException('Inicia sesión para continuar.');
    request.user = user;
    return true;
  }

  private cookieToken(request: Request): string | null {
    const cookies = request.headers.cookie?.split(';') ?? [];
    const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return null;
    try { return decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)); }
    catch { return null; }
  }

  private bearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
  }
}
