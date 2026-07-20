import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { OrganizationAccessService } from './organization-access.service';
import { AuthPayload } from './request-context';

type GuardRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  user?: AuthPayload;
};

type TokenPayload = {
  sub: number;
  email: string;
  role?: string;
  organization_id?: number;
  organization_confirmed?: boolean;
  iat?: number;
  exp?: number;
};

const routePermissions: Array<[RegExp, string]> = [
  [/^\/api\/dashboard/, 'dashboard'],
  [/^\/api\/activity/, 'activity'],
  [/^\/api\/users/, 'users'],
  [/^\/api\/buildings/, 'buildings'],
  [/^\/api\/units/, 'units'],
  [/^\/api\/tenants/, 'tenants'],
  [/^\/api\/invoices/, 'invoices'],
  [/^\/api\/payments/, 'payments'],
  [/^\/api\/cash/, 'cash'],
  [/^\/api\/employees/, 'staff'],
  [/^\/api\/salary-advances/, 'payroll'],
  [/^\/api\/leaves/, 'payroll'],
  [/^\/api\/payrolls/, 'payroll'],
  [/^\/api\/stock/, 'stock'],
  [/^\/api\/maintenance/, 'maintenance'],
  [/^\/api\/workflows/, 'workflow'],
  [/^\/api\/communications/, 'communication'],
  [/^\/api\/notifications/, 'notifications'],
  [/^\/api\/settings/, 'settings'],
  [/^\/api\/automations/, 'automations'],
  [/^\/api\/reference-data/, 'reference_data'],
  [/^\/api\/reports/, 'reports'],
  [/^\/api\/leases/, 'documents'],
];

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor(
    private readonly organizationAccess: OrganizationAccessService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.get<string>('JWT_SECRET') ?? 'local-demo-secret';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    if (request.path === '/api/auth/login' || request.path === '/api/auth/logout' || request.path === '/api/health') return true;

    const tokenPayload = this.decode(request);
    const lockedOrganizationId =
      tokenPayload.organization_confirmed && Number.isFinite(Number(tokenPayload.organization_id))
        ? Number(tokenPayload.organization_id)
        : undefined;
    const requestedOrganizationId = lockedOrganizationId ?? this.readRequestedOrganizationId(request);
    const user = await this.organizationAccess.resolveUserContext(tokenPayload.sub, requestedOrganizationId);
    request.user = {
      ...user,
      organization_confirmed: Boolean(tokenPayload.organization_confirmed),
    };

    if (!tokenPayload.organization_confirmed && !this.isPreSelectionRoute(request.path)) {
      throw new ForbiddenException('Sélectionnez une organisation pour terminer la connexion.');
    }

    const permission = this.permissionFor(request.path, request.method);
    if (!permission || user.permissions.includes('*') || user.permissions.includes(permission)) return true;
    throw new ForbiddenException(`Permission required: ${permission}`);
  }

  private decode(request: GuardRequest): TokenPayload {
    const header = request.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    const token = authorization.slice('Bearer '.length);
    const [body, signature] = token.split('.');
    const expected = createHmac('sha256', this.jwtSecret)
      .update(body)
      .digest('base64url');
    if (signature !== expected) throw new UnauthorizedException('Invalid token');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
      throw new UnauthorizedException('Token expired');
    }
    return payload;
  }

  private readRequestedOrganizationId(request: GuardRequest) {
    const raw = request.headers['x-organization-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private permissionFor(path: string, method: string) {
    if (/^\/api\/guarantee-cash\/expenses$/.test(path)) {
      return 'guarantee_cash.expense';
    }
    if (/^\/api\/guarantee-cash\/report$/.test(path)) {
      return 'guarantee_cash.export';
    }
    if (/^\/api\/guarantee-cash/.test(path)) {
      return method === 'GET' ? 'guarantee_cash.read' : 'guarantee_cash.create';
    }
    if (/^\/api\/tenants\/trash$/.test(path)) {
      return 'tenants.read';
    }
    if (/^\/api\/tenants\/\d+\/deletion-impact$/.test(path)) {
      return 'tenants.delete';
    }
    if (/^\/api\/tenants\/\d+\/trash$/.test(path)) {
      return 'tenants.delete';
    }
    if (/^\/api\/tenants\/\d+\/restore$/.test(path)) {
      return 'tenants.update';
    }
    if (/^\/api\/tenants\/\d+\/permanent$/.test(path)) {
      return 'tenants.delete';
    }
    if (/^\/api\/leases\/trash$/.test(path)) {
      return 'leases.trash.read';
    }
    if (/^\/api\/leases\/archives$/.test(path)) {
      return 'leases.archives.read';
    }
    if (/^\/api\/leases\/\d+\/deletion-impact$/.test(path)) {
      return 'leases.delete';
    }
    if (/^\/api\/leases\/\d+\/trash$/.test(path)) {
      return 'leases.delete';
    }
    if (/^\/api\/leases\/\d+\/restore$/.test(path)) {
      return 'leases.restore';
    }
    if (/^\/api\/leases\/\d+\/permanent$/.test(path)) {
      return 'leases.hard_delete';
    }
    if (/^\/api\/leases\/\d+\/archive$/.test(path)) {
      return 'leases.archive';
    }
    if (/^\/api\/hr/.test(path)) {
      if (method === 'GET') return 'staff.read';
      if (method === 'POST') return 'staff.create';
      return 'staff.update';
    }
    if (/^\/api\/reports\/tenants\/\d+$/.test(path)) {
      return method === 'GET' ? 'tenants.read' : 'reports.export';
    }
    const resource = routePermissions.find(([pattern]) => pattern.test(path))?.[1];
    if (!resource) return undefined;
    if (resource === 'reports') return method === 'GET' ? 'reports.read' : 'reports.export';
    if (resource === 'maintenance') {
      if (method === 'GET') return 'maintenance.read';
      if (path.includes('/assign')) return 'maintenance.assign';
      if (path.includes('/approve') || path.includes('/validate')) return 'maintenance.validate';
      if (path.includes('/close')) return 'maintenance.close';
      return method === 'POST' ? 'maintenance.create' : 'maintenance.update';
    }
    if (resource === 'workflow') {
      if (method === 'GET') return 'workflow.read';
      if (path.includes('/approve')) return 'workflow.approve';
      if (path.includes('/reject')) return 'workflow.reject';
      if (path.includes('/cancel')) return 'workflow.cancel';
      if (path.includes('/definitions')) return 'workflow.configure';
      return 'workflow.create';
    }
    if (resource === 'communication') {
      if (method === 'GET') return path.includes('logs') ? 'communication.logs.read' : 'communication.read';
      if (path.includes('/send-')) return 'communication.send';
      if (path.includes('/templates') && method === 'POST') return 'communication.template.create';
      if (path.includes('/templates') && (method === 'PUT' || method === 'PATCH')) return 'communication.template.update';
      if (path.includes('/templates') && method === 'DELETE') return 'communication.template.delete';
      return 'communication.read';
    }
    if (resource === 'notifications') return method === 'GET' ? 'notifications.read' : 'notifications.update';
    if (resource === 'settings') {
      if (path.includes('/restricted')) return 'publisher_settings.read';
      return method === 'GET' ? 'settings.read' : 'settings.update';
    }
    if (resource === 'automations') {
      if (method === 'GET') return 'automations.read';
      if (path.includes('/preview') || path.endsWith('/run')) return 'automations.run';
      return 'automations.update';
    }
    if (resource === 'reference_data') {
      const action = method === 'GET' ? 'read' : method === 'POST' ? 'create' : method === 'PUT' || method === 'PATCH' ? 'update' : method === 'DELETE' ? 'delete' : 'read';
      return `reference_data.${action}`;
    }
    if (resource === 'documents') {
      if (path.endsWith('/invoice')) return 'invoices.create';
      if (path.includes('/guarantee/pay') || path.includes('/guarantee/refund')) return 'cash.create';
      if (path.includes('/activate') || path.includes('/terminate')) return 'documents.upload';
      return method === 'GET' ? 'documents.read' : method === 'DELETE' ? 'documents.delete' : 'documents.upload';
    }
    if (resource === 'cash' && path.includes('/close')) return 'cash.close';
    if (resource === 'cash' && method === 'DELETE' && path.includes('/movements/')) return 'cash.update';
    const action = method === 'GET' ? 'read' : method === 'POST' ? 'create' : method === 'PUT' || method === 'PATCH' ? 'update' : method === 'DELETE' ? 'delete' : 'read';
    return `${resource}.${action}`;
  }

  private isPreSelectionRoute(path: string) {
    return path === '/api/auth/me' || path === '/api/auth/switch-organization' || path === '/api/auth/logout';
  }
}
