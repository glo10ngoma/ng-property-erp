export const SALES_MODULE_CODE = 'SALES';

export const SALES_BUYER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export const SALES_BUYER_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const SALES_PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
export const SALES_COMMERCIAL_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN', 'BLOCKED'] as const;
export const SALES_SUPPORTED_CURRENCIES = ['USD', 'CDF'] as const;

export type SalesBootstrap = {
  module: string;
  organization_id: number;
  permissions: string[];
  settings: Record<string, unknown> | null;
};

export type SalesSettings = {
  id?: number;
  organization_id?: number;
  default_currency?: string | null;
  secondary_currency?: string | null;
  quotation_prefix?: string | null;
  reservation_prefix?: string | null;
  contract_prefix?: string | null;
  receipt_prefix?: string | null;
  invoice_prefix?: string | null;
  settings_json?: Record<string, unknown> | null;
};

export type SalesListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: string;
};

export type SalesListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type SalesBuyer = {
  id: number;
  organization_id: number;
  buyer_ref: string;
  buyer_type: (typeof SALES_BUYER_TYPES)[number] | string;
  full_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  id_document_type?: string | null;
  id_document_number?: string | null;
  tax_number?: string | null;
  status: (typeof SALES_BUYER_STATUSES)[number] | string;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type SalesProject = {
  id: number;
  organization_id: number;
  project_ref: string;
  name: string;
  description?: string | null;
  location_label?: string | null;
  status: (typeof SALES_PROJECT_STATUSES)[number] | string;
  launch_date?: string | null;
  closing_date?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type SalesCatalogItem = {
  id: number;
  organization_id: number;
  project_id?: number | null;
  building_id?: number | null;
  unit_id?: number | null;
  catalog_ref: string;
  property_type: string;
  title: string;
  description?: string | null;
  list_price?: number | null;
  minimum_price?: number | null;
  currency?: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string | null;
  commercial_status: (typeof SALES_COMMERCIAL_STATUSES)[number] | string;
  availability_date?: string | null;
  surface_area?: number | null;
  location_label?: string | null;
  metadata?: Record<string, unknown> | null;
  project_name?: string | null;
  building_name?: string | null;
  unit_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type CreateSalesBuyerInput = {
  buyer_ref: string;
  buyer_type: string;
  full_name?: string;
  company_name?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  id_document_type?: string;
  id_document_number?: string;
  tax_number?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSalesProjectInput = {
  project_ref: string;
  name: string;
  description?: string;
  location_label?: string;
  status?: string;
  launch_date?: string;
  closing_date?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSalesCatalogInput = {
  catalog_ref: string;
  property_type: string;
  title: string;
  description?: string;
  project_id?: number;
  building_id?: number;
  unit_id?: number;
  list_price?: number;
  minimum_price?: number;
  currency?: string;
  commercial_status?: string;
  availability_date?: string;
  surface_area?: number;
  location_label?: string;
  metadata?: Record<string, unknown>;
};
