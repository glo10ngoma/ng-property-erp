import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthPayload } from './request-context';

type RequestWithUser = {
  user?: AuthPayload;
};

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) throw new UnauthorizedException('Missing token');
    const platformRole = String(request.user.platform_role ?? request.user.role ?? '').toUpperCase();
    if (platformRole === 'SUPER_ADMIN' || platformRole === 'ADMIN_PLATFORM') {
      return true;
    }
    throw new ForbiddenException('Platform access denied');
  }
}
