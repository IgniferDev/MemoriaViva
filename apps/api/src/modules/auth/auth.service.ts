import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AuthenticatedUser } from './auth.types.js';

const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const PASSWORD_BYTES = 64;

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
type SessionPayload = AuthenticatedUser & { iat: number; exp: number };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async register(input: RegisterDto): Promise<{ user: object; token: string }> {
    const email = this.normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese correo.');
    const birthDate = new Date(`${input.birthDate.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(birthDate.valueOf()) || birthDate > new Date()) {
      throw new BadRequestException('La fecha de nacimiento no es válida.');
    }
    const user = await this.prisma.user.create({
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        birthDate,
        country: input.country.trim(),
        email,
        passwordHash: await this.hashPassword(input.password),
      },
      select: { id: true, firstName: true, lastName: true, birthDate: true, country: true, email: true },
    });
    return { user, token: this.createToken({ id: user.id, email: user.email }) };
  }

  async login(input: LoginDto): Promise<{ user: object; token: string }> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user ? await this.verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !valid) throw new UnauthorizedException('El correo o la contraseña no son correctos.');
    const { passwordHash: _passwordHash, ...profile } = user;
    return { user: profile, token: this.createToken({ id: user.id, email: user.email }) };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, birthDate: true, country: true, email: true },
    });
    if (!user) throw new UnauthorizedException('La sesión ya no es válida.');
    return user;
  }

  verifyToken(token: string): AuthenticatedUser | null {
    const secret = this.secret();
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra) return null;
    const signed = `${encodedHeader}.${encodedPayload}`;
    const expected = createHmac('sha256', secret).update(signed).digest();
    let actual: Buffer;
    try { actual = Buffer.from(encodedSignature, 'base64url'); } catch { return null; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
      if (header.alg !== 'HS256' || header.typ !== 'JWT' || !payload.id || !payload.email || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return { id: payload.id, email: payload.email };
    } catch { return null; }
  }

  private createToken(user: AuthenticatedUser): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...user, iat: now, exp: now + SESSION_SECONDS })).toString('base64url');
    const signed = `${header}.${payload}`;
    const signature = createHmac('sha256', this.secret()).update(signed).digest('base64url');
    return `${signed}.${signature}`;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await this.scrypt(password, salt, PASSWORD_BYTES);
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  private async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [algorithm, nText, rText, pText, saltText, hashText, extra] = encoded.split('$');
    if (algorithm !== 'scrypt' || !nText || !rText || !pText || !saltText || !hashText || extra) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (salt.length < 16 || expected.length !== PASSWORD_BYTES) return false;
    const actual = await this.scrypt(password, salt, expected.length, {
      N: Number(nText), r: Number(rText), p: Number(pText), maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  }

  private scrypt(password: string, salt: Buffer, keyLength: number, options?: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scryptCallback(password, salt, keyLength, options ?? { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      });
    });
  }

  private normalizeEmail(email: string): string { return email.trim().toLocaleLowerCase('en-US'); }

  private secret(): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret || secret.length < 32) throw new Error('AUTH_SECRET debe contener al menos 32 caracteres.');
    return secret;
  }
}
