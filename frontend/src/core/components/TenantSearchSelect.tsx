import { useMemo, useState } from 'react';

export type TenantSearchOption = {
  id: number;
  first_name: string;
  last_name: string;
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
  const [query, setQuery] = useState('');
  const selected = tenants.find((tenant) => tenant.id === value) ?? null;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return tenants.slice(0, 8);
    return tenants.filter((tenant) => tenantLabel(tenant).toLowerCase().includes(term)).slice(0, 8);
  }, [query, tenants]);

  return (
    <div className="search-select">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={selected ? tenantLabel(selected) : 'Rechercher un locataire'}
      />
      <input name={name} value={value ?? ''} readOnly type="hidden" />
      {required && !value && <span className="search-select-required">Selectionnez un locataire.</span>}
      <div className="search-select-list">
        {filtered.map((tenant) => (
          <button
            className={tenant.id === value ? 'search-select-option active' : 'search-select-option'}
            key={tenant.id}
            type="button"
            onClick={() => {
              onChange(tenant.id);
              setQuery('');
            }}
          >
            <span>{tenantName(tenant)}</span>
            <small>{tenantMeta(tenant)}</small>
          </button>
        ))}
        {!filtered.length && <div className="search-select-empty">Aucun locataire trouve</div>}
      </div>
    </div>
  );
}

function tenantName(tenant: TenantSearchOption) {
  return `${tenant.first_name} ${tenant.last_name}`.trim();
}

function tenantMeta(tenant: TenantSearchOption) {
  return [tenant.phone, tenant.building_name, tenant.unit_number].filter(Boolean).join(' - ') || '-';
}

function tenantLabel(tenant: TenantSearchOption) {
  return `${tenantName(tenant)} - ${tenantMeta(tenant)}`;
}
