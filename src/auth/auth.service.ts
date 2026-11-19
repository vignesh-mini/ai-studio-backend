import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { toUserDto } from '../users/user.mapper.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name?.trim() || email.split('@')[0],
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
    });
    return this.createSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    // Same message for unknown email and wrong password, so accounts can't be probed.
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    return this.createSession(user);
  }

  /** Rotates the refresh token: the presented one is revoked and a new pair is issued. */
  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.createSession(stored.user);
  }

  /**
   * Owners are configured in OWNER_EMAILS, never from the app. The role is synced on
   * every sign-in and refresh, so removing an email demotes the account.
   */
  private async syncRole(user: User): Promise<User> {
    const owners = String(this.config.get('OWNER_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const role = owners.includes(user.email) ? 'owner' : 'user';
    if (user.role === role) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { role } });
  }

  private async createSession(current: User) {
    const user = await this.syncRole(current);
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_TOKEN_DAYS') ?? 30);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      plan: user.plan,
      role: user.role,
    });
    return { user: toUserDto(user), accessToken, refreshToken };
  }
}
