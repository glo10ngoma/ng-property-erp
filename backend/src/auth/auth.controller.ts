import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString } from 'class-validator';
import { createHmac } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { hashPassword, verifyPassword } from './password';
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

class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  newPassword: string;

  @IsString()
  confirmPassword: string;
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

    const requestedOrganizationId = this.readRequestedOrganizationId(request);
    const loginUser = await this.organizationAccess.loginPayload(Number(user.id), requestedOrganizationId);
    const activeOrganizations = (loginUser.organizations ?? []).filter((organization) => organization.is_active);
    const organizationConfirmed = activeOrganizations.length <= 1;

    return {
      token: this.issueToken({
        sub: Number(user.id),
        email: String(user.email),
        role: String(loginUser.platform_role ?? loginUser.role),
        organizationId: loginUser.organization_id,
        organizationConfirmed,
      }),
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
    if (request.user.organization_confirmed) {
      throw new ForbiddenException('Déconnectez-vous puis reconnectez-vous pour changer d’organisation.');
    }

    const nextUser = await this.organizationAccess.loginPayload(request.user.sub, Number(dto.organizationId));
    return {
      token: this.issueToken({
        sub: request.user.sub,
        email: request.user.email,
        role: String(nextUser.platform_role ?? nextUser.role),
        organizationId: nextUser.organization_id,
        organizationConfirmed: true,
      }),
      user: nextUser,
    };
  }

  @Patch('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @Req() request: RequestWithHeaders) {
    if (!request.user) throw new UnauthorizedException('Missing token');

    const currentPassword = String(dto.currentPassword ?? '');
    const newPassword = String(dto.newPassword ?? '');
    const confirmPassword = String(dto.confirmPassword ?? '');

    this.validatePasswordChangePayload(currentPassword, newPassword, confirmPassword);

    const { rows } = await this.db.query(
      `SELECT id, password_hash
       FROM app_users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [request.user.sub],
    );
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    const nextHash = await hashPassword(newPassword);
    await this.db.query(
      `UPDATE app_users
       SET password_hash = $2, updated_at = NOW()
       WHERE id = $1`,
      [request.user.sub, nextHash],
    );

    await this.writePasswordAudit(request.user);

    return {
      message: 'Mot de passe modifié avec succès. Veuillez vous reconnecter.',
      forceLogout: true,
    };
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

  private issueToken(input: {
    sub: number;
    email: string;
    role: string;
    organizationId?: number;
    organizationConfirmed: boolean;
  }) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({
        sub: input.sub,
        email: input.email,
        role: input.role,
        organization_id: input.organizationId ?? null,
        organization_confirmed: input.organizationConfirmed,
        iat: issuedAt,
        exp: issuedAt + this.absoluteTimeoutSeconds,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private validatePasswordChangePayload(currentPassword: string, newPassword: string, confirmPassword: string) {
    if (!currentPassword.trim()) {
      throw new BadRequestException('Le mot de passe actuel est obligatoire.');
    }
    if (!newPassword) {
      throw new BadRequestException('Le nouveau mot de passe est obligatoire.');
    }
    if (!confirmPassword) {
      throw new BadRequestException('La confirmation du nouveau mot de passe est obligatoire.');
    }
    if (newPassword !== newPassword.trim() || confirmPassword !== confirmPassword.trim()) {
      throw new BadRequestException('Les mots de passe ne doivent pas contenir d’espaces en début ou fin.');
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’ancien.');
    }
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('La confirmation du nouveau mot de passe ne correspond pas.');
    }
    if (!this.isStrongPassword(newPassword)) {
      throw new BadRequestException('Le nouveau mot de passe doit contenir au moins 12 caractères, avec majuscule, minuscule, chiffre et caractère spécial.');
    }
  }

  private isStrongPassword(password: string) {
    if (password.length < 12) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[a-z]/.test(password)) return false;
    if (!/\d/.test(password)) return false;
    if (!/[^\w\s]/.test(password)) return false;
    return true;
  }

  private async writePasswordAudit(user: AuthPayload) {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (
           organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.organization_id ?? 1,
          user.sub,
          'PASSWORD_CHANGED',
          'auth',
          String(user.sub),
          'PATCH',
          '/api/auth/change-password',
          200,
          JSON.stringify({ organization_confirmed: Boolean(user.organization_confirmed) }),
        ],
      );
    } catch (error: any) {
      if (error?.code === '42P01') {
        return;
      }
      throw error;
    }
  }
}
