import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationModulesService } from './organization-modules.service';
import { ORGANIZATION_MODULE_METADATA_KEY } from './sales-module.decorator';

@Injectable()
export class SalesModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly organizationModules: OrganizationModulesService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const moduleCode = this.reflector.getAllAndOverride<string>(ORGANIZATION_MODULE_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!moduleCode) {
      return true;
    }

    const enabled = await this.organizationModules.isEnabledForCurrentOrganization(moduleCode);
    if (enabled) {
      return true;
    }

    throw new ForbiddenException({
      code: 'MODULE_NOT_ENABLED',
      message: `Module ${moduleCode} is not enabled for the current organization.`,
    });
  }
}
