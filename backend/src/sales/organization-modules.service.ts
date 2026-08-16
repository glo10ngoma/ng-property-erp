import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import { normalizeSalesModuleCode } from './types';

@Injectable()
export class OrganizationModulesService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async isEnabledForCurrentOrganization(moduleCode: string) {
    return this.isEnabledForOrganization(this.context.organizationId(), moduleCode);
  }

  async isEnabledForOrganization(organizationId: number, moduleCode: string) {
    try {
      const { rows } = await this.db.query<{ is_enabled: boolean }>(
        `SELECT is_enabled
         FROM organization_modules
         WHERE organization_id = $1 AND module_code = $2
         LIMIT 1`,
        [organizationId, normalizeSalesModuleCode(moduleCode)],
      );
      return Boolean(rows[0]?.is_enabled);
    } catch (error: any) {
      if (error?.code === '42P01') {
        return false;
      }
      throw error;
    }
  }

  async listEnabledModulesForOrganization(organizationId: number) {
    try {
      const { rows } = await this.db.query<{ module_code: string }>(
        `SELECT module_code
         FROM organization_modules
         WHERE organization_id = $1 AND is_enabled = TRUE
         ORDER BY module_code ASC`,
        [organizationId],
      );
      return rows.map((row) => normalizeSalesModuleCode(row.module_code));
    } catch (error: any) {
      if (error?.code === '42P01') {
        return [];
      }
      throw error;
    }
  }
}
