import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString } from 'class-validator';
import { createHmac } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { verifyPassword } from './password';
import { OrganizationAccessService } from './organization-access.service';
import { AuthPayload } from './request-context';

class LoginDto {
  @IsString()
  email: string;

  @IsString()
  password: string;
}

class SwitchOrganizationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  organizationId: number;
}

type RequestWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPayload;
};

@Controller('auth')
export class AuthController {
  private readonly jwtSecret: string;
  private readonly absoluteTimeoutSeconds: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationAccess: OrganizationAccessService,
    config: ConfigService,
  ) {
    const jwtSecret = config.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('Missing required environment variable JWT_SECRET');
    }
    this.jwtSecret = jwtSecret;
    const configuredHours = Number(config.get<string>('SESSION_ABSOLUTE_TIMEOUT_HOURS') ?? '8');
    const resolvedHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 8;
    this.absoluteTimeoutSeconds = Math.round(resolvedHours * 60 * 60);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() request: RequestWithHeaders) {
    const { rows } = await this.db.query(
      `SELECT id, email, status, password_hash, role, platform_role
       FROM app_users
       WHERE email = $1
       LIMIT 1`,
      [dto.email],
    );
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        role: user.platform_role ?? user.role,
        iat: issuedAt,
        exp: issuedAt + this.absoluteTimeoutSeconds,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret).update(body).digest('base64url');
    const requestedOrganizationId = this.readRequestedOrganizationId(request);
    const loginUser = await this.organizationAccess.loginPayload(Number(user.id), requestedOrganizationId);

    return {
      token: `${body}.${signature}`,
      user: loginUser,
    };
  }

  @Get('me')
  async me(@Req() request: RequestWithHeaders) {
    if (!request.user) throw new UnauthorizedException('Missing token');
    return this.organizationAccess.loginPayload(request.user.sub, request.user.organization_id);
  }

  @Post('switch-organization')
  async switchOrganization(@Body() dto: SwitchOrganizationDto, @Req() request: RequestWithHeaders) {
    if (!request.user) throw new UnauthorizedException('Missing token');
    return this.organizationAccess.loginPayload(request.user.sub, Number(dto.organizationId));
  }

  @Post('logout')
  logout() {
    return { ok: true };
  }

  private readRequestedOrganizationId(request: RequestWithHeaders) {
    const raw = request.headers['x-organization-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
}
