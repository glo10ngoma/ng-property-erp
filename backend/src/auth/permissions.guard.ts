import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ROLE_PERMISSIONS, normalizeRole } from '../saas/permissions';
import { AuthPayload } from './request-context';

type GuardRequest = {
  path: string;
  method: string;
  headers: { authorization?: string };
  user?: AuthPayload;
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
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    if (request.path === '/api/auth/login' || request.path === '/api/auth/logout' || request.path === '/api/health') return true;
    const user = this.decode(request);
    request.user = user;
    const permission = this.permissionFor(request.path, request.method);
    if (!permission || user.permissions.includes('*') || user.permissions.includes(permission)) return true;
    throw new ForbiddenException(`Permission required: ${permission}`);
  }

  private decode(request: GuardRequest): AuthPayload {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    const token = header.slice('Bearer '.length);
    const [body, signature] = token.split('.');
    const expected = createHmac('sha256', process.env.JWT_SECRET ?? 'local-demo-secret')
      .update(body)
      .digest('base64url');
    if (signature !== expected) throw new UnauthorizedException('Invalid token');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthPayload;
    payload.role = normalizeRole(payload.role);
    payload.permissions = ROLE_PERMISSIONS[payload.role] ?? [];
    payload.organization_id = payload.organization_id ?? 1;
    return payload;
  }

  private permissionFor(path: string, method: string) {
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
    const action = method === 'GET' ? 'read' : method === 'POST' ? 'create' : method === 'PUT' || method === 'PATCH' ? 'update' : method === 'DELETE' ? 'delete' : 'read';
    return `${resource}.${action}`;
  }
}
