import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { ORGANIZATION_MODULE_METADATA_KEY } from '../sales/sales-module.decorator';
import { OrganizationModulesService } from '../sales/organization-modules.service';
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
  [/^\/api\/shareholders/, 'shareholders'],
  [/^\/api\/bank-accounts/, 'bank_accounts'],
  [/^\/api\/bank-transactions/, 'bank_transactions'],
  [/^\/api\/treasury-transfers/, 'treasury_transfers'],
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
  [/^\/api\/sales(?:\/|$)/, 'sales'],
];

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor(
    private readonly organizationAccess: OrganizationAccessService,
    private readonly organizationModules: OrganizationModulesService,
    private readonly reflector: Reflector,
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
    let user: AuthPayload;
    try {
      user = await this.organizationAccess.resolveUserContext(tokenPayload.sub, requestedOrganizationId);
      request.user = {
        ...user,
        organization_confirmed: Boolean(tokenPayload.organization_confirmed),
      };
    } catch (error: any) {
      const response = error?.response;
      const code = typeof response === 'object' && response ? response.code ?? response?.message?.code : undefined;
      if (code === 'ORGANIZATION_ACCESS_DENIED' && this.isPreSelectionRoute(request.path)) {
        user = await this.organizationAccess.resolveUserContext(tokenPayload.sub, undefined);
        request.user = {
          ...user,
          organization_confirmed: false,
          organization_access_denied: true,
          access_denied_message: 'Cette organisation n’est pas accessible avec votre compte.',
          organization_selection_required: true,
        };
      } else {
        throw error;
      }
    }

    if (!tokenPayload.organization_confirmed && !this.isPreSelectionRoute(request.path)) {
      throw new ForbiddenException('Sélectionnez une organisation pour terminer la connexion.');
    }

    const requiredModule = this.reflector.getAllAndOverride<string>(ORGANIZATION_MODULE_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredModule) {
      const enabled = await this.organizationModules.isEnabledForOrganization(user.organization_id, requiredModule);
      if (!enabled) {
        throw new ForbiddenException({
          code: 'MODULE_NOT_ENABLED',
          message: `Module ${requiredModule} is not enabled for the current organization.`,
        });
      }
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
    if (/^\/api\/sales\/bootstrap$/.test(path)) {
      return 'sales.read';
    }
    if (/^\/api\/sales\/settings$/.test(path)) {
      return method === 'GET' ? 'sales.settings.read' : 'sales.settings.manage';
    }
    if (/^\/api\/sales\/settings\/templates\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_templates.read' : 'sales_templates.manage';
    }
    if (/^\/api\/sales\/settings\/templates$/.test(path)) {
      return method === 'GET' ? 'sales_templates.read' : 'sales_templates.manage';
    }
    if (/^\/api\/sales\/buyers\/\d+\/archive$/.test(path)) {
      return 'sales_buyers.archive';
    }
    if (/^\/api\/sales\/buyers\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_buyers.read' : 'sales_buyers.update';
    }
    if (/^\/api\/sales\/buyers$/.test(path)) {
      return method === 'GET' ? 'sales_buyers.read' : 'sales_buyers.create';
    }
    if (/^\/api\/sales\/projects\/\d+\/archive$/.test(path)) {
      return 'sales_projects.archive';
    }
    if (/^\/api\/sales\/projects\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_projects.read' : 'sales_projects.update';
    }
    if (/^\/api\/sales\/projects$/.test(path)) {
      return method === 'GET' ? 'sales_projects.read' : 'sales_projects.create';
    }
    if (/^\/api\/sales\/catalog\/\d+\/archive$/.test(path)) {
      return 'sales_catalog.archive';
    }
    if (/^\/api\/sales\/catalog\/\d+\/status$/.test(path)) {
      return 'sales_catalog.update';
    }
    if (/^\/api\/sales\/catalog\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_catalog.read' : 'sales_catalog.update';
    }
    if (/^\/api\/sales\/catalog$/.test(path)) {
      return method === 'GET' ? 'sales_catalog.read' : 'sales_catalog.create';
    }
    if (/^\/api\/sales\/reservations\/\d+\/confirm$/.test(path)) {
      return 'sales_reservations.approve';
    }
    if (/^\/api\/sales\/reservations\/\d+\/cancel$/.test(path)) {
      return 'sales_reservations.cancel';
    }
    if (/^\/api\/sales\/reservations\/\d+\/convert$/.test(path) || /^\/api\/sales\/reservations\/\d+\/expire$/.test(path)) {
      return 'sales_reservations.update';
    }
    if (/^\/api\/sales\/reservations\/\d+\/documents\/regenerate$/.test(path)) {
      return 'sales_documents.regenerate';
    }
    if (/^\/api\/sales\/reservations\/\d+\/documents$/.test(path)) {
      return 'sales_documents.read';
    }
    if (/^\/api\/sales\/reservations\/\d+\/payments$/.test(path)) {
      return method === 'GET' ? 'sales_reservation_payments.read' : 'sales_reservation_payments.create';
    }
    if (/^\/api\/sales\/reservations\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_reservations.read' : 'sales_reservations.update';
    }
    if (/^\/api\/sales\/reservations$/.test(path)) {
      return method === 'GET' ? 'sales_reservations.read' : 'sales_reservations.create';
    }
    if (/^\/api\/sales\/subscriptions\/simulate$/.test(path)) {
      return 'sales_subscriptions.create';
    }
    if (/^\/api\/sales\/subscriptions\/\d+\/approve$/.test(path)) {
      return 'sales_subscriptions.approve';
    }
    if (/^\/api\/sales\/subscriptions\/\d+\/reject$/.test(path) || /^\/api\/sales\/subscriptions\/\d+\/submit$/.test(path)) {
      return 'sales_subscriptions.update';
    }
    if (/^\/api\/sales\/subscriptions\/\d+\/cancel$/.test(path)) {
      return 'sales_subscriptions.cancel';
    }
    if (/^\/api\/sales\/subscriptions\/\d+\/documents\/regenerate$/.test(path)) {
      return 'sales_documents.regenerate';
    }
    if (/^\/api\/sales\/subscriptions\/\d+\/documents$/.test(path)) {
      return 'sales_documents.read';
    }
    if (/^\/api\/sales\/subscriptions\/\d+$/.test(path)) {
      return method === 'GET' ? 'sales_subscriptions.read' : 'sales_subscriptions.update';
    }
    if (/^\/api\/sales\/subscriptions$/.test(path)) {
      return method === 'GET' ? 'sales_subscriptions.read' : 'sales_subscriptions.create';
    }
    if (/^\/api\/sales\/documents\/\d+\/download$/.test(path)) {
      return 'sales_documents.download';
    }
    if (/^\/api\/sales\/reservation-payments\/\d+\/receipt\/regenerate$/.test(path)) {
      return 'sales_reservation_receipts.generate';
    }
    if (/^\/api\/sales\/reservation-payments\/\d+\/cancel$/.test(path)) {
      return 'sales_reservation_payments.cancel';
    }
    if (/^\/api\/sales\/reservation-payments\/\d+\/refunds$/.test(path)) {
      return 'sales_reservation_payments.refund';
    }
    if (/^\/api\/sales\/reservation-payments\/\d+$/.test(path)) {
      return 'sales_reservation_payments.read';
    }
    if (/^\/api\/bank-dashboard/.test(path)) {
      return 'bank_accounts.read';
    }
    if (/^\/api\/treasury-transfers\/\d+$/.test(path)) {
      return 'treasury_transfers.read';
    }
    if (/^\/api\/cash\/treasury-transfers\/form-data$/.test(path)) {
      return 'treasury_transfers.from_cash';
    }
    if (/^\/api\/cash\/treasury-transfers$/.test(path)) {
      return 'treasury_transfers.create';
    }
    if (/^\/api\/bank\/treasury-transfers\/form-data$/.test(path)) {
      return 'treasury_transfers.read';
    }
    if (/^\/api\/bank\/treasury-transfers$/.test(path)) {
      return 'treasury_transfers.create';
    }
    if (/^\/api\/bank-transactions/.test(path)) {
      return 'bank_transactions.read';
    }
    if (/^\/api\/bank\/shareholder-payouts\/form-data$/.test(path) || /^\/api\/bank\/shareholder-payouts$/.test(path)) {
      return 'shareholder_payouts.from_bank';
    }
    if (/^\/api\/bank-accounts/.test(path)) {
      if (method === 'GET') return 'bank_accounts.read';
      if (method === 'POST') return 'bank_accounts.create';
      return 'bank_accounts.update';
    }
    if (/^\/api\/shareholder-payout-lines\/\d+\/receipt$/.test(path)) {
      return 'shareholder_payouts.receipt';
    }
    if (/^\/api\/shareholder-payout-lines\/trash$/.test(path)) {
      return 'shareholder_payouts.read';
    }
    if (/^\/api\/shareholder-payout-lines\/\d+$/.test(path)) {
      return method === 'DELETE' ? 'shareholder_payouts.delete' : 'shareholder_payouts.read';
    }
    if (/^\/api\/shareholder-payouts\/\d+\/summary$/.test(path)) {
      return 'shareholder_payouts.export';
    }
    if (/^\/api\/shareholder-payouts\/\d+$/.test(path)) {
      return 'shareholder_payouts.read';
    }
    if (/^\/api\/shareholder-payouts/.test(path)) {
      return method === 'GET' ? 'shareholder_payouts.read' : 'shareholder_payouts.create';
    }
    if (/^\/api\/cash\/shareholder-payouts/.test(path)) {
      return 'shareholder_payouts.create';
    }
    if (/^\/api\/guarantee-cash\/shareholder-payouts/.test(path)) {
      return 'shareholder_payouts.from_guarantee_cash';
    }
    if (/^\/api\/tenant-credits\/\d+\/refund$/.test(path)) {
      return 'tenant_credits.refund';
    }
    if (/^\/api\/tenant-credits\/\d+\/cancel$/.test(path)) {
      return 'tenant_credits.cancel';
    }
    if (/^\/api\/tenant-credits\/\d+\/restore$/.test(path)) {
      return 'payments.update';
    }
    if (/^\/api\/tenant-credits\/refunds\/\d+\/restore$/.test(path)) {
      return 'payments.update';
    }
    if (/^\/api\/tenant-credits\/refunds\/\d+$/.test(path)) {
      return 'payments.read';
    }
    if (/^\/api\/tenant-credits\/\d+$/.test(path) && method === 'PATCH') {
      return 'tenant_credits.update';
    }
    if (/^\/api\/tenant-credits/.test(path)) {
      if (method === 'GET') return 'payments.read';
      if (method === 'PATCH') return 'tenant_credits.update';
      return 'payments.create';
    }
    if (/^\/api\/payments\/\d+\/restore$/.test(path)) {
      return 'payments.update';
    }
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
    if (resource === 'sales') return 'sales.read';
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
      if (path.includes('/email/logs')) return 'communication.logs';
      if (path.includes('/email/test-connection') || path.includes('/email/send-test')) return 'communication.test';
      if (path.includes('/email/settings')) return method === 'GET' ? 'communication.read' : 'communication.update';
      if (path.includes('/send-document')) return 'communication.send';
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
