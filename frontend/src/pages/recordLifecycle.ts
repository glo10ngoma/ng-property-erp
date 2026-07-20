import { api } from '../api';
import { formatLeaseReference } from '../utils/lease-reference';

export type LifecycleEntityType = 'lease' | 'tenant';
export type LifecycleObjectFilter = 'all' | LifecycleEntityType;

export type LeaseLifecycleRecord = {
  id: number;
  lease_number?: number;
  tenant_name: string;
  building_name: string;
  unit_number: string;
  status: string;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
  deletion_reason?: string | null;
  archived_at?: string | null;
  archived_by_name?: string | null;
  archive_reason?: string | null;
};

export type LeaseDeletionImpact = {
  canHardDelete: boolean;
  hasFinancialHistory: boolean;
  dependencies: Array<{ type: string; count: number }>;
};

export type TenantLifecycleRecord = {
  id: number;
  tenant_number?: number | null;
  client_reference?: string;
  tenant_type?: string;
  first_name?: string;
  last_name?: string;
  post_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  status: string;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
  deletion_reason?: string | null;
  lease_count?: number;
  invoice_count?: number;
  payment_count?: number;
};

export type TrashListItem = {
  entityType: LifecycleEntityType;
  recordId: number;
  reference: string;
  designation: string;
  associatedInfo: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  reason?: string | null;
  raw: LeaseLifecycleRecord | TenantLifecycleRecord;
};

export type ArchiveListItem = {
  entityType: 'lease';
  recordId: number;
  reference: string;
  designation: string;
  associatedInfo: string;
  archivedAt?: string | null;
  archivedBy?: string | null;
  reason?: string | null;
  hasHistory: boolean;
  raw: LeaseLifecycleRecord;
};

export type TrashEntityProvider = {
  type: LifecycleEntityType;
  label: string;
  load: () => Promise<TrashListItem[]>;
  restore: (recordId: number) => Promise<void>;
  loadDeletionImpact: (recordId: number) => Promise<LeaseDeletionImpact>;
  permanentDelete: (recordId: number, reason?: string | null) => Promise<{ archived?: boolean }>;
  archive: (recordId: number, reason?: string | null) => Promise<void>;
  buildDetailPath: (recordId: number) => string;
  canRestorePermission: string;
  canPermanentDeletePermission?: string;
  canArchivePermission?: string;
};

export type ArchiveEntityProvider = {
  type: 'lease';
  label: string;
  load: () => Promise<ArchiveListItem[]>;
  buildDetailPath: (recordId: number) => string;
};

function buildAssociatedInfo(record: LeaseLifecycleRecord) {
  return [record.building_name, record.unit_number].filter(Boolean).join(' · ');
}

function mapLeaseTrashRow(record: LeaseLifecycleRecord): TrashListItem {
  return {
    entityType: 'lease',
    recordId: record.id,
    reference: formatLeaseReference(record.lease_number, record.id),
    designation: record.tenant_name,
    associatedInfo: buildAssociatedInfo(record),
    deletedAt: record.deleted_at,
    deletedBy: record.deleted_by_name,
    reason: record.deletion_reason,
    raw: record,
  };
}

function mapLeaseArchiveRow(record: LeaseLifecycleRecord): ArchiveListItem {
  return {
    entityType: 'lease',
    recordId: record.id,
    reference: formatLeaseReference(record.lease_number, record.id),
    designation: record.tenant_name,
    associatedInfo: buildAssociatedInfo(record),
    archivedAt: record.archived_at,
    archivedBy: record.archived_by_name,
    reason: record.archive_reason,
    hasHistory: true,
    raw: record,
  };
}

function tenantName(record: TenantLifecycleRecord) {
  if (record.tenant_type === 'COMPANY') return record.company_name || 'Locataire';
  return [record.first_name, record.last_name, record.post_name].filter(Boolean).join(' ').trim() || 'Locataire';
}

function mapTenantTrashRow(record: TenantLifecycleRecord): TrashListItem {
  const associatedInfo = [
    Number(record.lease_count ?? 0) ? `${record.lease_count} bail(s)` : '',
    Number(record.invoice_count ?? 0) ? `${record.invoice_count} facture(s)` : '',
    Number(record.payment_count ?? 0) ? `${record.payment_count} paiement(s)` : '',
  ].filter(Boolean).join(' · ');
  return {
    entityType: 'tenant',
    recordId: record.id,
    reference: record.client_reference ?? `CLI-${String(record.tenant_number ?? record.id).padStart(6, '0')}`,
    designation: tenantName(record),
    associatedInfo,
    deletedAt: record.deleted_at,
    deletedBy: record.deleted_by_name,
    reason: record.deletion_reason,
    raw: record,
  };
}

const leaseTrashProvider: TrashEntityProvider = {
  type: 'lease',
  label: 'Baux et contrats',
  async load() {
    const response = await api.get<LeaseLifecycleRecord[]>('/leases/trash');
    return response.data.map(mapLeaseTrashRow);
  },
  async restore(recordId) {
    await api.post(`/leases/${recordId}/restore`);
  },
  async loadDeletionImpact(recordId) {
    const response = await api.get<LeaseDeletionImpact>(`/leases/${recordId}/deletion-impact`);
    return response.data;
  },
  async permanentDelete(recordId, reason) {
    const response = await api.delete<{ archived?: boolean }>(`/leases/${recordId}/permanent`, {
      data: { reason: reason?.trim() || null },
    });
    return response.data ?? {};
  },
  async archive(recordId, reason) {
    await api.post(`/leases/${recordId}/archive`, { reason: reason?.trim() || null });
  },
  buildDetailPath(recordId) {
    return `/leases/${recordId}?scope=trash`;
  },
  canRestorePermission: 'leases.restore',
  canPermanentDeletePermission: 'leases.hard_delete',
  canArchivePermission: 'leases.archive',
};

const tenantTrashProvider: TrashEntityProvider = {
  type: 'tenant',
  label: 'Locataires',
  async load() {
    const response = await api.get<TenantLifecycleRecord[]>('/tenants/trash');
    return response.data.map(mapTenantTrashRow);
  },
  async restore(recordId) {
    await api.post(`/tenants/${recordId}/restore`);
  },
  async loadDeletionImpact(recordId) {
    const response = await api.get<LeaseDeletionImpact>(`/tenants/${recordId}/deletion-impact`);
    return response.data;
  },
  async permanentDelete(recordId) {
    await api.delete(`/tenants/${recordId}/permanent`);
    return {};
  },
  async archive() {
    throw new Error("L'archivage définitif des locataires n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/tenants/${recordId}/situation`;
  },
  canRestorePermission: 'tenants.update',
};

const leaseArchiveProvider: ArchiveEntityProvider = {
  type: 'lease',
  label: 'Baux et contrats',
  async load() {
    const response = await api.get<LeaseLifecycleRecord[]>('/leases/archives');
    return response.data.map(mapLeaseArchiveRow);
  },
  buildDetailPath(recordId) {
    return `/leases/${recordId}?scope=archive`;
  },
};

export const trashEntityProviders: Record<LifecycleEntityType, TrashEntityProvider> = {
  lease: leaseTrashProvider,
  tenant: tenantTrashProvider,
};

export const archiveEntityProviders: Record<'lease', ArchiveEntityProvider> = {
  lease: leaseArchiveProvider,
};

export const lifecycleObjectOptions: Array<{ value: LifecycleObjectFilter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'lease', label: 'Baux et contrats' },
  { value: 'tenant', label: 'Locataires' },
];

export function lifecycleEntityLabel(entityType: LifecycleEntityType) {
  if (entityType === 'lease') return 'Bail / Contrat';
  if (entityType === 'tenant') return 'Locataire';
  return entityType;
}
