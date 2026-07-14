import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPayload } from './request-context';

const SUPER_ADMIN_MESSAGE_KEY = 'super_admin_only_message';

export const SuperAdminOnly = (message?: string) => SetMetadata(SUPER_ADMIN_MESSAGE_KEY, message);

type RequestWithUser = {
  user?: AuthPayload;
};

@Injectable()
export class SuperAdminOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new UnauthorizedException('Missing token');
    }

    const platformRole = String(request.user.platform_role ?? request.user.role ?? '').trim().toUpperCase();
    if (platformRole === 'SUPER_ADMIN') {
      return true;
    }

    const message =
      this.reflector.getAllAndOverride<string | undefined>(SUPER_ADMIN_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'Seul le Super Administrateur peut effectuer cette action.';

    throw new ForbiddenException(message);
  }
}
