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
  platform_role?: string | null;
  organization_role?: string | null;
  organization_id?: number;
  organization_name?: string;
  organization_slug?: string;
  organizations?: Array<{
    organization_id: number;
    organization_name: string;
    organization_slug: string;
    role_code: string;
    is_active: boolean;
    is_default: boolean;
  }>;
  permissions: string[];
};
