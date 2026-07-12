import { ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, PageHeader, SuccessMessage } from '../../../components';

type CompanySettings = {
  logo_url?: string;
  invoice_logo_url?: string;
  signature_url?: string;
  stamp_url?: string;
  company_name: string;
  legal_name?: string;
  company_legal_name?: string;
  company_acronym?: string;
  company_legal_form?: string;
  company_rccm?: string;
  company_national_id?: string;
  company_tax_id?: string;
  address?: string;
  company_commune?: string;
  company_city?: string;
  company_country?: string;
  phone?: string;
  email?: string;
  website?: string;
  legal_representative_name?: string;
  legal_representative_title?: string;
  currency: string;
  language: string;
  timezone: string;
  invoice_footer?: string;
  paper_format: string;
  invoice_bottom_text?: string;
};

type ReferenceData = {
  id: number;
  type: string;
  code: string;
  label: string;
  description?: string;
  sort_order: number;
  status: string;
};

type PublisherService = { title: string; action: string };
type RestrictedSetting = { label: string; status: string };
type ExchangeRate = {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  createdAt?: string;
  updatedAt?: string;
};

const referenceTypeLabels: Record<string, string> = {
  charge_types: 'Types de charges',
  expense_categories: 'Categories de depenses',
  stock_categories: 'Categories stock',
  document_types: 'Types de documents',
  staff_positions: 'Fonctions du personnel',
  leave_types: 'Types de conges',
  payment_methods: 'Modes de paiement',
  banks: 'Banques',
  cities: 'Villes',
};

export function SettingsPage() {
  const { can } = useAuth();
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [references, setReferences] = useState<ReferenceData[]>([]);
  const [services, setServices] = useState<PublisherService[]>([]);
  const [restricted, setRestricted] = useState<RestrictedSetting[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [exchangeRateDraft, setExchangeRateDraft] = useState('');
  const [exchangeRateDateDraft, setExchangeRateDateDraft] = useState(new Date().toISOString().slice(0, 10));
  const [success, setSuccess] = useState('');

  async function load() {
    const [companyResponse, referencesResponse, servicesResponse, exchangeRateResponse] = await Promise.all([
      api.get<CompanySettings>('/settings/company'),
      api.get<ReferenceData[]>('/reference-data'),
      api.get<PublisherService[]>('/settings/publisher-services'),
      api.get<ExchangeRate | null>('/settings/exchange-rate').catch(() => ({ data: null })),
    ]);

    setCompany(companyResponse.data);
    setReferences(referencesResponse.data);
    setServices(servicesResponse.data);
    setExchangeRate(exchangeRateResponse.data ?? null);
    setExchangeRateDraft(exchangeRateResponse.data ? String(exchangeRateResponse.data.rate) : '');
    setExchangeRateDateDraft(exchangeRateResponse.data?.effectiveDate ?? new Date().toISOString().slice(0, 10));
  }

  async function loadRestricted() {
    if (!can('publisher_settings.read')) return;
    const response = await api.get<RestrictedSetting[]>('/settings/restricted');
    setRestricted(response.data);
  }

  useEffect(() => {
    void load();
    void loadRestricted();
  }, []);

  async function updateCompany(form: FormData) {
    await api.patch('/settings/company', Object.fromEntries(form));
    setSuccess('Parametres enregistres.');
    await load();
  }

  async function updateExchangeRate(form: FormData) {
    const response = await api.patch<ExchangeRate>('/settings/exchange-rate', {
      rate: Number(form.get('rate')),
      effective_date: form.get('effective_date'),
    });
    const next = response.data ?? null;
    setExchangeRate(next);
    setExchangeRateDraft(next ? String(next.rate) : '');
    setExchangeRateDateDraft(next?.effectiveDate ?? new Date().toISOString().slice(0, 10));
    setSuccess('Taux de change enregistre.');
    await load();
  }

  const groupedReferences = useMemo(() => {
    return references.reduce<Record<string, ReferenceData[]>>((accumulator, item) => {
      const key = referenceTypeLabels[item.type] ?? item.type;
      accumulator[key] = [...(accumulator[key] ?? []), item];
      return accumulator;
    }, {});
  }, [references]);

  return (
    <section>
      <PageHeader title="Parametres" />
      <SuccessMessage message={success} />

      {company && (
        <>
          <SettingsSection title="Entreprise" hint="Informations generales du bailleur reutilisees dans les contrats, factures et impressions.">
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void updateCompany(new FormData(event.currentTarget)); }}>
              <Field label="Nom entreprise">
                <input name="company_name" defaultValue={company.company_name} disabled={!can('settings.update')} required />
              </Field>
              <Field label="Raison sociale">
                <input name="company_legal_name" defaultValue={company.company_legal_name ?? company.legal_name ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Sigle">
                <input name="company_acronym" defaultValue={company.company_acronym ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Forme juridique">
                <input name="company_legal_form" defaultValue={company.company_legal_form ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="RCCM">
                <input name="company_rccm" defaultValue={company.company_rccm ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Identification nationale">
                <input name="company_national_id" defaultValue={company.company_national_id ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Numero fiscal">
                <input name="company_tax_id" defaultValue={company.company_tax_id ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Telephone">
                <input name="phone" defaultValue={company.phone ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Adresse e-mail">
                <input name="email" defaultValue={company.email ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Adresse">
                <input name="address" defaultValue={company.address ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Commune">
                <input name="company_commune" defaultValue={company.company_commune ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Ville">
                <input name="company_city" defaultValue={company.company_city ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Pays">
                <input name="company_country" defaultValue={company.company_country ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Representant legal">
                <input name="legal_representative_name" defaultValue={company.legal_representative_name ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Titre representant">
                <input name="legal_representative_title" defaultValue={company.legal_representative_title ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Site web">
                <input name="website" defaultValue={company.website ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Logo">
                <input name="logo_url" defaultValue={company.logo_url ?? ''} disabled={!can('settings.update')} />
              </Field>
              {can('settings.update') && <div className="form-actions"><button>Enregistrer</button></div>}
            </form>

            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void updateExchangeRate(new FormData(event.currentTarget)); }}>
              <Field label="Devise de reference">
                <input value="USD" readOnly className="locked-field" />
              </Field>
              <Field label="Devise locale">
                <input value="CDF" readOnly className="locked-field" />
              </Field>
              <Field label="Taux courant">
                <input name="rate" type="number" min="0.000001" step="0.000001" value={exchangeRateDraft} onChange={(event) => setExchangeRateDraft(event.target.value)} disabled={!can('settings.update')} required />
              </Field>
              <Field label="Date d application">
                <input name="effective_date" type="date" value={exchangeRateDateDraft} onChange={(event) => setExchangeRateDateDraft(event.target.value)} disabled={!can('settings.update')} required />
              </Field>
              <Field label="Derniere modification">
                <input value={exchangeRate?.updatedAt ?? exchangeRate?.createdAt ?? '-'} readOnly className="locked-field" />
              </Field>
              <Field label="Utilisateur">
                <input value={exchangeRate ? 'Administrateur' : '-'} readOnly className="locked-field" />
              </Field>
              {can('settings.update') && <div className="form-actions"><button>Enregistrer taux</button></div>}
            </form>
          </SettingsSection>

          <SettingsSection title="Facturation" hint="Reglages deja persistes et zones de personnalisation de sortie.">
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void updateCompany(new FormData(event.currentTarget)); }}>
              <Field label="Devise">
                <input name="currency" defaultValue={company.currency} disabled={!can('settings.update')} />
              </Field>
              <Field label="Format papier">
                <select name="paper_format" defaultValue={company.paper_format} disabled={!can('settings.update')}>
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="LETTER">Letter</option>
                </select>
              </Field>
              <Field label="Logo facture">
                <input name="invoice_logo_url" defaultValue={company.invoice_logo_url ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Signature">
                <input name="signature_url" defaultValue={company.signature_url ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Cachet">
                <input name="stamp_url" defaultValue={company.stamp_url ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Pied de page facture">
                <textarea name="invoice_footer" defaultValue={company.invoice_footer ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Texte bas de facture">
                <textarea name="invoice_bottom_text" defaultValue={company.invoice_bottom_text ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Prefixe facture">
                <input value="Bientot" disabled />
              </Field>
              <Field label="Jour d echeance par defaut">
                <input value="Bientot" disabled />
              </Field>
              <Field label="Coordonnees bancaires">
                <input value="Bientot" disabled />
              </Field>
              {can('settings.update') && <div className="form-actions"><button>Enregistrer</button></div>}
            </form>
          </SettingsSection>
        </>
      )}

      <SettingsSection title="Immobilier">
        <PlaceholderGrid
          items={[
            ['Ville par defaut', 'Bientot'],
            ['Types d immeubles', summaryFromReferences(groupedReferences['Villes'])],
            ['Types d unites', 'Bientot'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Stock">
        <PlaceholderGrid
          items={[
            ['Seuil de securite par defaut', 'Bientot'],
            ['Responsable stock', 'Bientot'],
            ['Notification rupture', 'Bientot'],
            ['Notification sous seuil', 'Bientot'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Ressources humaines">
        <PlaceholderGrid
          items={[
            ['Jours ouvrables par defaut', 'Bientot'],
            ['Devise paie', company?.currency ?? 'USD'],
            ['Methode salaire journalier', 'Bientot'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <PlaceholderGrid
          items={[
            ['Email', 'Simulation locale'],
            ['WhatsApp', 'Simulation locale'],
            ['SMS', 'Simulation locale'],
            ['Preferences activation', 'Bientot'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Securite">
        <PlaceholderGrid
          items={[
            ['Duree session', 'Bientot'],
            ['Politique mot de passe', 'Bientot'],
            ['Audit', 'Actif'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Referentiels">
        {!Object.keys(groupedReferences).length ? (
          <EmptyState message="Aucun referentiel disponible." />
        ) : (
          <div className="chart-grid">
            {Object.entries(groupedReferences).map(([label, items]) => (
              <article className="chart-card" key={label}>
                <h3>{label}</h3>
                <p>{items.slice(0, 4).map((item) => item.label).join(', ') || 'Aucune donnee'}</p>
                <small>{items.length} valeur(s)</small>
              </article>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Services complementaires">
        <div className="chart-grid">
          {services.map((service) => (
            <article className="chart-card" key={service.title}>
              <h3>{service.title}</h3>
              <button className="secondary">{service.action}</button>
            </article>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Reserve editeur">
        {!can('publisher_settings.read') ? (
          <EmptyState message="Acces reserve." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Parametre avance</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {restricted.map((item) => (
                  <tr key={item.label}>
                    <td>{item.label}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </section>
  );
}

function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      {hint ? <p className="muted-text">{hint}</p> : null}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
    </label>
  );
}

function PlaceholderGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="detail-list">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function summaryFromReferences(items?: ReferenceData[]) {
  if (!items?.length) return 'Bientot';
  return `${items.length} valeur(s) disponibles`;
}
