import { api } from '../api';
import { formatLeaseReference } from '../utils/lease-reference';

export type LifecycleEntityType = 'lease' | 'tenant' | 'payment' | 'tenant_credit' | 'tenant_credit_refund' | 'cash' | 'guarantee_cash' | 'shareholder_payout';
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
  raw: LeaseLifecycleRecord | TenantLifecycleRecord | FinanceTrashRecord;
};

export type FinanceTrashRecord = {
  id: number;
  payment_type?: string | null;
  movement_type?: string | null;
  type?: string | null;
  category?: string | null;
  payment_date?: string | null;
  movement_date?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  receipt_number?: string | null;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
  deletion_reason?: string | null;
  invoice_id?: number | null;
  invoice_number?: string | null;
  tenant_name?: string | null;
  lease_number?: number | null;
  organization_id?: number | null;
  batch_id?: number | null;
  batch_reference?: string | null;
  shareholder_name?: string | null;
  tenant_credit_id?: number | null;
  credit_reference?: string | null;
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

function financeReference(record: FinanceTrashRecord, fallbackPrefix: string) {
  const direct = String(record.reference ?? '').trim();
  if (direct) return direct;

  const receipt = String(record.receipt_number ?? '').trim();
  if (receipt) return receipt;

  return `${fallbackPrefix}-${String(record.id).padStart(6, '0')}`;
}

function financeAssociatedInfo(record: FinanceTrashRecord) {
  return [
    record.invoice_number || '',
    record.tenant_name || '',
    record.currency ? `${record.amount ?? 0} ${record.currency}` : '',
  ].filter(Boolean).join(' · ');
}

const paymentTrashProvider: TrashEntityProvider = {
  type: 'payment',
  label: 'Paiements',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/payments/trash');
    return response.data.map((record) => ({
      entityType: 'payment',
      recordId: record.id,
      reference: financeReference(record, 'PAY'),
      designation: record.invoice_number ?? record.tenant_name ?? 'Paiement',
      associatedInfo: financeAssociatedInfo(record),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore(recordId) {
    await api.post(`/payments/${recordId}/restore`);
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/payments/${recordId}?scope=trash`;
  },
  canRestorePermission: 'payments.update',
  canPermanentDeletePermission: 'finance.hard_delete',
};

const tenantCreditTrashProvider: TrashEntityProvider = {
  type: 'tenant_credit',
  label: 'Crédits locataires',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/tenant-credits/trash');
    return response.data.map((record) => ({
      entityType: 'tenant_credit',
      recordId: record.id,
      reference: financeReference(record, 'TC'),
      designation: record.tenant_name ?? 'Crédit locataire',
      associatedInfo: financeAssociatedInfo(record),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore(recordId) {
    await api.post(`/tenant-credits/${recordId}/restore`);
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/tenant-credits?credit_id=${recordId}&scope=trash`;
  },
  canRestorePermission: 'payments.update',
};

const tenantCreditRefundTrashProvider: TrashEntityProvider = {
  type: 'tenant_credit_refund',
  label: 'Remboursements crédits locataires',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/tenant-credits/refunds/trash');
    return response.data.map((record) => ({
      entityType: 'tenant_credit_refund',
      recordId: record.id,
      reference: financeReference(record, 'TCR'),
      designation: record.tenant_name ?? record.credit_reference ?? 'Remboursement crédit locataire',
      associatedInfo: [
        record.credit_reference ?? '',
        record.currency ? `${record.amount ?? 0} ${record.currency}` : '',
      ].filter(Boolean).join(' Â· '),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore(recordId) {
    await api.post(`/tenant-credits/refunds/${recordId}/restore`);
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/tenant-credits/refunds/${recordId}?scope=trash`;
  },
  canRestorePermission: 'payments.update',
};

const cashTrashProvider: TrashEntityProvider = {
  type: 'cash',
  label: 'Caisse principale',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/cash/trash');
    return response.data.map((record) => ({
      entityType: 'cash',
      recordId: record.id,
      reference: financeReference(record, 'CASH'),
      designation: record.invoice_number ?? record.category ?? 'Mouvement de caisse',
      associatedInfo: financeAssociatedInfo(record),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore() {
    throw new Error("La restauration des mouvements de caisse n'est pas encore disponible.");
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/cash/${recordId}`;
  },
  canRestorePermission: 'finance.restore',
  canPermanentDeletePermission: 'finance.hard_delete',
};

const guaranteeCashTrashProvider: TrashEntityProvider = {
  type: 'guarantee_cash',
  label: 'Caisse garanties',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/guarantee-cash/trash');
    return response.data.map((record) => ({
      entityType: 'guarantee_cash',
      recordId: record.id,
      reference: financeReference(record, 'GRC'),
      designation: record.invoice_number ?? record.movement_type ?? 'Mouvement garantie',
      associatedInfo: financeAssociatedInfo(record),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore() {
    throw new Error("La restauration des mouvements de garantie n'est pas encore disponible.");
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/guarantee-cash?movement=${recordId}`;
  },
  canRestorePermission: 'finance.restore',
  canPermanentDeletePermission: 'finance.hard_delete',
};

const shareholderPayoutTrashProvider: TrashEntityProvider = {
  type: 'shareholder_payout',
  label: 'Remboursements actionnaires',
  async load() {
    const response = await api.get<FinanceTrashRecord[]>('/shareholder-payout-lines/trash');
    return response.data.map((record) => ({
      entityType: 'shareholder_payout',
      recordId: record.id,
      reference: financeReference(record, 'SHR'),
      designation: record.shareholder_name ?? record.batch_reference ?? 'Remboursement actionnaire',
      associatedInfo: [
        record.batch_reference ?? '',
        record.currency ? `${record.amount ?? 0} ${record.currency}` : '',
      ].filter(Boolean).join(' · '),
      deletedAt: record.deleted_at,
      deletedBy: record.deleted_by_name,
      reason: record.deletion_reason,
      raw: record,
    }));
  },
  async restore() {
    throw new Error("La restauration des remboursements actionnaires n'est pas encore disponible.");
  },
  async loadDeletionImpact() {
    return { canHardDelete: false, hasFinancialHistory: true, dependencies: [] };
  },
  async permanentDelete() {
    return {};
  },
  async archive() {
    throw new Error("L'archivage n'est pas disponible.");
  },
  buildDetailPath(recordId) {
    return `/shareholder-payout-lines/${recordId}/receipt`;
  },
  canRestorePermission: 'finance.restore',
  canPermanentDeletePermission: 'finance.hard_delete',
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
  payment: paymentTrashProvider,
  tenant_credit: tenantCreditTrashProvider,
  tenant_credit_refund: tenantCreditRefundTrashProvider,
  cash: cashTrashProvider,
  guarantee_cash: guaranteeCashTrashProvider,
  shareholder_payout: shareholderPayoutTrashProvider,
};

export const archiveEntityProviders: Record<'lease', ArchiveEntityProvider> = {
  lease: leaseArchiveProvider,
};

export const lifecycleObjectOptions: Array<{ value: LifecycleObjectFilter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'lease', label: 'Baux et contrats' },
  { value: 'tenant', label: 'Locataires' },
  { value: 'payment', label: 'Paiements' },
  { value: 'tenant_credit', label: 'Crédits locataires' },
  { value: 'tenant_credit_refund', label: 'Remboursements crédits locataires' },
  { value: 'cash', label: 'Caisse principale' },
  { value: 'guarantee_cash', label: 'Caisse garanties' },
  { value: 'shareholder_payout', label: 'Remboursements actionnaires' },
];

export function lifecycleEntityLabel(entityType: LifecycleEntityType) {
  if (entityType === 'lease') return 'Bail / Contrat';
  if (entityType === 'tenant') return 'Locataire';
  if (entityType === 'payment') return 'Paiement';
  if (entityType === 'tenant_credit') return 'Crédit locataire';
  if (entityType === 'tenant_credit_refund') return 'Remboursement crédit locataire';
  if (entityType === 'cash') return 'Caisse';
  if (entityType === 'guarantee_cash') return 'Garantie';
  if (entityType === 'shareholder_payout') return 'Remboursement actionnaire';
  return entityType;
}
