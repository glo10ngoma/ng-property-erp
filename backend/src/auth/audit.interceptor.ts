import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, tap, throwError } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { AuthPayload } from './request-context';

type RequestForAudit = {
  method: string;
  path: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  user?: AuthPayload;
};

type ResponseForAudit = {
  statusCode?: number;
};

const auditedMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<RequestForAudit>();
    const response = context.switchToHttp().getResponse<ResponseForAudit>();
    if (!request.user || request.path.startsWith('/api/auth') || !auditedMethods.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((result) => {
        void this.write(request, response.statusCode ?? 200, result);
      }),
      catchError((error) => {
        void this.write(request, error?.status ?? response.statusCode ?? 500, undefined, error?.message);
        return throwError(() => error);
      }),
    );
  }

  private async write(request: RequestForAudit, statusCode: number, result?: unknown, error?: string) {
    const resource = request.path.replace(/^\/api\//, '').split('/')[0] || 'unknown';
    const resourceId = request.params?.id ?? this.resultId(result);
    const action = this.actionFor(request.method, resource);
    await this.db.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        request.user?.organization_id ?? 1,
        request.user?.sub ?? null,
        action,
        resource,
        resourceId,
        request.method,
        request.path,
        statusCode,
        JSON.stringify({ body: this.safeBody(request.body), error: error ?? null }),
      ],
    );
  }

  private actionFor(method: string, resource: string) {
    if (resource === 'payments' && method === 'POST') return 'PAYMENT_CREATED';
    if (resource === 'cash' && method === 'POST') return 'CASH_ACTION';
    if (resource === 'users' && method === 'POST') return 'USER_CREATED';
    if (resource === 'users' && ['PUT', 'PATCH'].includes(method)) return 'USER_ROLE_OR_PERMISSION_CHANGED';
    if (method === 'POST') return 'CREATED';
    if (['PUT', 'PATCH'].includes(method)) return 'UPDATED';
    if (method === 'DELETE') return 'SOFT_DELETED';
    return 'CHANGED';
  }

  private resultId(result: unknown) {
    if (result && typeof result === 'object' && 'id' in result) return String((result as { id: unknown }).id);
    return null;
  }

  private safeBody(body?: Record<string, unknown>) {
    if (!body) return {};
    const { password, password_hash, ...safe } = body;
    void password;
    void password_hash;
    return safe;
  }
}
