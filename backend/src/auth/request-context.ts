import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export type AuthPayload = {
  sub: number;
  email: string;
  role: string;
  organization_id: number;
  permissions: string[];
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
