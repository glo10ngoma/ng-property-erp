import type { AuthUser } from '../../core/api/api.types';
import { SALES_MODULE_CODE } from './types';

export function hasSalesModule(user: AuthUser | null | undefined) {
  return Boolean(user?.active_modules?.includes(SALES_MODULE_CODE));
}
