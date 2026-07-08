import { SearchableSelect } from './SearchableSelect';

export type TenantSearchOption = {
  id: number;
  tenant_type?: string;
  company_name?: string;
  first_name: string;
  last_name: string;
  post_name?: string;
  phone?: string;
  building_name?: string;
  unit_number?: string;
};

export function TenantSearchSelect({
  tenants,
  value,
  onChange,
  name = 'tenant_id',
  required,
}: {
  tenants: TenantSearchOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  name?: string;
  required?: boolean;
}) {
  const options = tenants.map((tenant) => ({
    value: tenant.id,
    label: tenantName(tenant),
    meta: tenantMeta(tenant),
  }));

  return (
    <>
      <SearchableSelect
        emptyMessage="Aucun locataire trouve"
        onChange={onChange}
        options={options}
        placeholder="Rechercher un locataire"
        value={value}
      />
      <input name={name} value={value ?? ''} readOnly type="hidden" />
      {required && !value && <span className="search-select-required">Selectionnez un locataire.</span>}
    </>
  );
}

function tenantName(tenant: TenantSearchOption) {
  if (tenant.tenant_type === 'COMPANY') return tenant.company_name || 'Societe';
  return `${tenant.first_name ?? ''} ${tenant.last_name ?? ''} ${tenant.post_name ?? ''}`.trim();
}

function tenantMeta(tenant: TenantSearchOption) {
  return [tenant.phone, tenant.building_name, tenant.unit_number].filter(Boolean).join(' - ') || '-';
}
