import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export type AuthPayload = {
  sub: number;
  email: string;
  role: string;
  platform_role?: string | null;
  organization_confirmed?: boolean;
  organization_role?: string | null;
  organization_id: number;
  organization_name?: string | null;
  organization_slug?: string | null;
  permissions: string[];
  organizations?: UserOrganizationMembership[];
};

export type UserOrganizationMembership = {
  organization_id: number;
  organization_name: string;
  organization_slug: string;
  role_code: string;
  is_active: boolean;
  is_default: boolean;
};

type Store = {
  user?: AuthPayload;
};

@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<Store>();

  run<T>(store: Store, callback: () => T) {
    return this.storage.run(store, callback);
  }

  user() {
    return this.storage.getStore()?.user;
  }

  organizationId() {
    return this.user()?.organization_id ?? 1;
  }

  userId() {
    return this.user()?.sub ?? null;
  }
}
