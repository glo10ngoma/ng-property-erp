import { SetMetadata } from '@nestjs/common';
import { normalizeSalesModuleCode } from './types';

export const ORGANIZATION_MODULE_METADATA_KEY = 'organization-module-code';

export const RequireOrganizationModule = (moduleCode: string) =>
  SetMetadata(ORGANIZATION_MODULE_METADATA_KEY, normalizeSalesModuleCode(moduleCode));
