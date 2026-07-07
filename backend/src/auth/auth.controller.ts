import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createHmac } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ROLE_PERMISSIONS } from '../saas/permissions';
import { verifyPassword } from './password';
import { AuthPayload } from './request-context';

class LoginDto {
  @IsString()
  email: string;

  @IsString()
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly db: DatabaseService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const { rows } = await this.db.query(
      `SELECT id, first_name, last_name, email, role, status, password_hash, organization_id
       FROM app_users WHERE email = $1 LIMIT 1`,
      [dto.email],
    );
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id ?? 1,
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', process.env.JWT_SECRET ?? 'local-demo-secret').update(body).digest('base64url');
    return {
      token: `${body}.${signature}`,
      user: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.role,
        organization_id: user.organization_id ?? 1,
        permissions: payload.permissions,
      },
    };
  }

  @Get('me')
  me(@Req() request: { user?: AuthPayload }) {
    if (!request.user) throw new UnauthorizedException('Missing token');
    return {
      id: request.user.sub,
      email: request.user.email,
      role: request.user.role,
      organization_id: request.user.organization_id,
      permissions: request.user.permissions,
    };
  }

  @Post('logout')
  logout() {
    return { ok: true };
  }
}
