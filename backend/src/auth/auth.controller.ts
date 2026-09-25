import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Logger, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsPositive, IsString } from 'class-validator';
import { createHmac } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { hashPassword, isBcryptHash, verifyPassword } from './password';
import { OrganizationAccessService } from './organization-access.service';
import { PasswordResetService } from './password-reset.service';
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

class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  newPassword: string;

  @IsString()
  confirmPassword: string;
}

type RequestWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPayload;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly jwtSecret: string;
  private readonly absoluteTimeoutSeconds: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly passwordReset: PasswordResetService,
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
    const normalizedEmail = String(dto.email ?? '').trim().toLowerCase();
    const { rows } = await this.db.query(
      `SELECT id, email, status, password_hash, role, platform_role, COALESCE(password_version, 1) AS password_version
       FROM app_users
       WHERE LOWER(TRIM(email)) = $1
       LIMIT 1`,
      [normalizedEmail],
    );
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (isBcryptHash(String(user.password_hash ?? ''))) {
      this.rehashLegacyPassword(Number(user.id), dto.password).catch((error: unknown) => {
        this.logger.warn(`Unable to migrate legacy bcrypt password hash for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
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
        passwordVersion: Number(user.password_version ?? 1),
      }),
      user: loginUser,
    };
  }

  @Get('me')
  async me(@Req() request: RequestWithHeaders) {
    if (!request.user) throw new UnauthorizedException('Missing token');
    if (request.user.organization_access_denied) {
      const payload = await this.organizationAccess.loginPayload(request.user.sub);
      return {
        ...payload,
        organization_selection_required: true,
        access_denied_message: 'Cette organisation n’est pas accessible avec votre compte.',
      };
    }
    return this.organizationAccess.loginPayload(request.user.sub, request.user.organization_id);
  }

  @Post('switch-organization')
  async switchOrganization(@Body() dto: SwitchOrganizationDto, @Req() request: RequestWithHeaders) {
    if (!request.user) throw new UnauthorizedException('Missing token');
    if (request.user.organization_confirmed && !request.user.organization_access_denied) {
      throw new ForbiddenException('Déconnectez-vous puis reconnectez-vous pour changer d’organisation.');
    }

    const nextUser = await this.organizationAccess.loginPayload(request.user.sub, Number(dto.organizationId));
    const passwordVersion = await this.readPasswordVersion(request.user.sub);
    return {
      token: this.issueToken({
        sub: request.user.sub,
        email: request.user.email,
        role: String(nextUser.platform_role ?? nextUser.role),
        organizationId: nextUser.organization_id,
        organizationConfirmed: true,
        passwordVersion,
      }),
      user: nextUser,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: RequestWithHeaders) {
    return this.passwordReset.requestPasswordReset({
      email: dto.email,
      requestIp: this.readRequestIp(request),
    });
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: RequestWithHeaders) {
    return this.passwordReset.resetPassword({
      token: dto.token,
      newPassword: dto.newPassword,
      confirmPassword: dto.confirmPassword,
      requestIp: this.readRequestIp(request),
    });
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

    await this.passwordReset.updatePasswordForUser(request.user.sub, newPassword, {
      actorUserId: request.user.sub,
      organizationId: request.user.organization_id ?? 1,
      auditAction: 'PASSWORD_CHANGED',
      auditPath: '/api/auth/change-password',
      auditMethod: 'PATCH',
      auditMetadata: { organization_confirmed: Boolean(request.user.organization_confirmed) },
    });

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
    passwordVersion: number;
  }) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({
        sub: input.sub,
        email: input.email,
        role: input.role,
        organization_id: input.organizationId ?? null,
        organization_confirmed: input.organizationConfirmed,
        password_version: input.passwordVersion,
        iat: issuedAt,
        exp: issuedAt + this.absoluteTimeoutSeconds,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private async rehashLegacyPassword(userId: number, password: string) {
    const nextHash = await hashPassword(password);
    await this.db.query(
      `UPDATE app_users
       SET password_hash = $2,
           password_version = COALESCE(password_version, 1) + 1,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId, nextHash],
    );
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
    if (password.length > 128) return false;
    const normalized = password.trim().toLowerCase();
    if (['password', 'password123', 'qwerty123', 'azerty123', 'admin123', 'welcome123', 'letmein123'].includes(normalized)) {
      return false;
    }
    return true;
  }

  private async readPasswordVersion(userId: number) {
    const result = await this.db.query<{ password_version: number }>(
      `SELECT COALESCE(password_version, 1) AS password_version
       FROM app_users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId],
    );
    return Number(result.rows[0]?.password_version ?? 1);
  }

  private readRequestIp(request: RequestWithHeaders) {
    const forwarded = request.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (raw) {
      return String(raw).split(',')[0]?.trim() || null;
    }
    return request.ip?.trim() || request.socket?.remoteAddress?.trim() || null;
  }
}
