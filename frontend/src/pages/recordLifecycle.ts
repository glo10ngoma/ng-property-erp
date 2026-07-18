import { api } from '../api';
import { formatLeaseReference } from '../utils/lease-reference';

export type LifecycleEntityType = 'lease';
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

export type TrashListItem = {
  entityType: LifecycleEntityType;
  recordId: number;
  reference: string;
  designation: string;
  associatedInfo: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  reason?: string | null;
  raw: LeaseLifecycleRecord;
};

export type ArchiveListItem = {
  entityType: LifecycleEntityType;
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
};

export type ArchiveEntityProvider = {
  type: LifecycleEntityType;
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
};

export const archiveEntityProviders: Record<LifecycleEntityType, ArchiveEntityProvider> = {
  lease: leaseArchiveProvider,
};

export const lifecycleObjectOptions: Array<{ value: LifecycleObjectFilter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'lease', label: 'Baux et contrats' },
];

export function lifecycleEntityLabel(entityType: LifecycleEntityType) {
  if (entityType === 'lease') return 'Bail / Contrat';
  return entityType;
}
