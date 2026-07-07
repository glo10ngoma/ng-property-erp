export type ApiId = number;

export type ApiListResult<T> = {
  data: T[];
  loading: boolean;
  reload: () => Promise<void>;
};

export type Option = {
  id: number;
  name?: string;
  label?: string;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  organization_id?: number;
  organization_name?: string;
  permissions: string[];
};
