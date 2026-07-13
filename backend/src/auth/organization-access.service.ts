import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { permissionSetForRole } from '../saas/permissions';
import type { AuthPayload, UserOrganizationMembership } from './request-context';

type AppUserRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string | null;
  platform_role: string | null;
  status: string;
  organization_id: number | null;
};

type MembershipRow = {
  organization_id: number;
  organization_name: string;
  organization_slug: string;
  role_code: string;
  is_active: boolean;
  is_default: boolean;
};

type OrganizationRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
};

@Injectable()
export class OrganizationAccessService {
  private readonly logger = new Logger(OrganizationAccessService.name);

  constructor(private readonly db: DatabaseService) {}

  async resolveUserContext(userId: number, requestedOrganizationId?: number | null): Promise<AuthPayload> {
    const user = await this.findUser(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid user session');
    }

    const platformRole = this.platformRole(user.platform_role ?? user.role);
    const memberships = platformRole
      ? await this.loadAllOrganizationsForPlatformUser()
      : await this.loadMembershipsForClientUser(user);

    const activeOrganization = this.selectActiveOrganization(
      memberships,
      requestedOrganizationId,
      platformRole,
      user.organization_id ?? undefined,
    );

    return {
      sub: user.id,
      email: user.email,
      role: platformRole ?? activeOrganization.role_code,
      platform_role: platformRole,
      organization_role: activeOrganization.role_code,
      organization_id: activeOrganization.organization_id,
      organization_name: activeOrganization.organization_name,
      organization_slug: activeOrganization.organization_slug,
      permissions: permissionSetForRole(platformRole ?? activeOrganization.role_code),
      organizations: memberships,
    };
  }

  async loginPayload(userId: number, requestedOrganizationId?: number | null) {
    const context = await this.resolveUserContext(userId, requestedOrganizationId);
    const user = await this.findUser(userId);
    return {
      id: context.sub,
      name: [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || context.email,
      email: context.email,
      role: context.role,
      platform_role: context.platform_role,
      organization_role: context.organization_role,
      organization_id: context.organization_id,
      organization_name: context.organization_name,
      organization_slug: context.organization_slug,
      organizations: context.organizations,
      permissions: context.permissions,
    };
  }

  private async findUser(userId: number) {
    const { rows } = await this.db.query<AppUserRow>(
      `SELECT id, first_name, last_name, email, role, platform_role, status, organization_id
       FROM app_users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId],
    );
    return rows[0];
  }

  private async loadMembershipsForClientUser(user: AppUserRow): Promise<UserOrganizationMembership[]> {
    try {
      const { rows } = await this.db.query<MembershipRow>(
        `SELECT
           uo.organization_id,
           o.name AS organization_name,
           o.slug AS organization_slug,
           uo.role_code,
           uo.is_active,
           uo.is_default
         FROM user_organizations uo
         JOIN organizations o ON o.id = uo.organization_id
         WHERE uo.user_id = $1
         ORDER BY uo.is_default DESC, o.name ASC`,
        [user.id],
      );
      if (rows.length) {
        return rows.map((row) => ({
          organization_id: Number(row.organization_id),
          organization_name: row.organization_name,
          organization_slug: row.organization_slug,
          role_code: row.role_code,
          is_active: row.is_active,
          is_default: row.is_default,
        }));
      }
    } catch (error: any) {
      if (error?.code !== '42P01') throw error;
    }

    if (!user.organization_id) {
      throw new ForbiddenException('No active organization membership found');
    }

    const fallbackOrganization = await this.findOrganization(user.organization_id);
    if (!fallbackOrganization) {
      throw new ForbiddenException('Organization not found');
    }

    this.logger.warn(
      `Membership fallback used for user ${user.id} (${user.email}) on organization ${user.organization_id}. user_organizations is missing or has no active row yet.`,
    );

    return [
      {
        organization_id: fallbackOrganization.id,
        organization_name: fallbackOrganization.name,
        organization_slug: fallbackOrganization.slug,
        role_code: this.legacyClientRole(user.role),
        is_active: true,
        is_default: true,
      },
    ];
  }

  private async loadAllOrganizationsForPlatformUser(): Promise<UserOrganizationMembership[]> {
    const { rows } = await this.db.query<OrganizationRow>(
      `SELECT id, name, slug, status
       FROM organizations
       WHERE status = 'ACTIVE'
       ORDER BY name ASC`,
    );

    return rows.map((row) => ({
      organization_id: Number(row.id),
      organization_name: row.name,
      organization_slug: row.slug,
      role_code: 'ADMIN',
      is_active: row.status === 'ACTIVE',
      is_default: false,
    }));
  }

  private selectActiveOrganization(
    organizations: UserOrganizationMembership[],
    requestedOrganizationId?: number | null,
    platformRole?: 'SUPER_ADMIN' | 'ADMIN_PLATFORM' | null,
    fallbackOrganizationId?: number,
  ) {
    const requested = requestedOrganizationId
      ? organizations.find((item) => item.organization_id === requestedOrganizationId && item.is_active)
      : undefined;

    if (requestedOrganizationId && !requested) {
      throw new ForbiddenException('Organization access denied');
    }

    const chosen = requested
      ?? organizations.find((item) => item.is_active && item.is_default)
      ?? organizations.find((item) => item.is_active)
      ?? null;

    if (chosen) {
      return chosen;
    }

    if (platformRole && fallbackOrganizationId) {
      return {
        organization_id: fallbackOrganizationId,
        organization_name: `Organisation ${fallbackOrganizationId}`,
        organization_slug: `organization-${fallbackOrganizationId}`,
        role_code: 'ADMIN',
        is_active: true,
        is_default: true,
      } satisfies UserOrganizationMembership;
    }

    throw new ForbiddenException('No active organization available');
  }

  private async findOrganization(organizationId: number) {
    const { rows } = await this.db.query<OrganizationRow>(
      `SELECT id, name, slug, status
       FROM organizations
       WHERE id = $1
       LIMIT 1`,
      [organizationId],
    );
    return rows[0];
  }

  private platformRole(role?: string | null) {
    const value = String(role ?? '').trim().toUpperCase();
    if (value === 'SUPER_ADMIN') return 'SUPER_ADMIN' as const;
    if (value === 'ADMIN_PLATFORM') return 'ADMIN_PLATFORM' as const;
    if (value === 'ADMIN') {
      this.logger.warn('Legacy platform role fallback detected for role ADMIN. Expected explicit platform_role=ADMIN_PLATFORM.');
      return 'ADMIN_PLATFORM' as const;
    }
    return null;
  }

  private legacyClientRole(role?: string | null) {
    const value = String(role ?? '').trim().toUpperCase();
    if (value === 'ADMIN_CLIENT') return 'ADMIN_CLIENT';
    if (value === 'ADMIN') return 'ADMIN_CLIENT';
    if (['EDITOR_CLIENT', 'EDITOR', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE'].includes(value)) {
      return 'EDITOR_CLIENT';
    }
    return 'VIEWER_CLIENT';
  }
}
