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
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
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

const referenceTypeLabels: Record<string, string> = {
  charge_types: 'Types de charges',
  expense_categories: 'Catégories de dépenses',
  stock_categories: 'Catégories stock',
  document_types: 'Types de documents',
  staff_positions: 'Fonctions du personnel',
  leave_types: 'Types de congés',
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
  const [success, setSuccess] = useState('');

  async function load() {
    const [companyResponse, referencesResponse, servicesResponse] = await Promise.all([
      api.get<CompanySettings>('/settings/company'),
      api.get<ReferenceData[]>('/reference-data'),
      api.get<PublisherService[]>('/settings/publisher-services'),
    ]);

    setCompany(companyResponse.data);
    setReferences(referencesResponse.data);
    setServices(servicesResponse.data);
  }

  async function loadRestricted() {
    if (!can('publisher_settings.read')) return;
    const response = await api.get<RestrictedSetting[]>('/settings/restricted');
    setRestricted(response.data);
  }

  useEffect(() => {
    load();
    loadRestricted();
  }, []);

  async function updateCompany(form: FormData) {
    await api.patch('/settings/company', Object.fromEntries(form));
    setSuccess('Paramètres enregistrés.');
    load();
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
      <PageHeader title="Paramètres" />
      <SuccessMessage message={success} />

      {company && (
        <>
          <SettingsSection title="Entreprise" hint="Informations générales visibles sur les documents et impressions.">
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); updateCompany(new FormData(event.currentTarget)); }}>
              <Field label="Nom entreprise">
                <input name="company_name" defaultValue={company.company_name} disabled={!can('settings.update')} required />
              </Field>
              <Field label="Raison sociale">
                <input name="legal_name" defaultValue={company.legal_name ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Téléphone">
                <input name="phone" defaultValue={company.phone ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Adresse e-mail">
                <input name="email" defaultValue={company.email ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Adresse">
                <input name="address" defaultValue={company.address ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="Site web">
                <input name="website" defaultValue={company.website ?? ''} disabled={!can('settings.update')} />
              </Field>
              <Field label="RCCM">
                <input value="Bientôt" disabled />
              </Field>
              <Field label="NIF">
                <input value="Bientôt" disabled />
              </Field>
              <Field label="Logo">
                <input name="logo_url" defaultValue={company.logo_url ?? ''} disabled={!can('settings.update')} />
              </Field>
              {can('settings.update') && <div className="form-actions"><button>Enregistrer</button></div>}
            </form>
          </SettingsSection>

          <SettingsSection title="Facturation" hint="Réglages déjà persistés et champs avancés signalés sans fausse sauvegarde.">
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); updateCompany(new FormData(event.currentTarget)); }}>
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
              <Field label="Préfixe facture">
                <input value="Bientôt" disabled />
              </Field>
              <Field label="Jour d’échéance par défaut">
                <input value="Bientôt" disabled />
              </Field>
              <Field label="Coordonnées bancaires">
                <input value="Bientôt" disabled />
              </Field>
              {can('settings.update') && <div className="form-actions"><button>Enregistrer</button></div>}
            </form>
          </SettingsSection>
        </>
      )}

      <SettingsSection title="Immobilier">
        <PlaceholderGrid
          items={[
            ['Ville par défaut', 'Bientôt'],
            ['Types d’immeubles', summaryFromReferences(groupedReferences['Villes'])],
            ['Types d’unités', 'Bientôt'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Stock">
        <PlaceholderGrid
          items={[
            ['Seuil de sécurité par défaut', 'Bientôt'],
            ['Responsable stock', 'Bientôt'],
            ['Notification rupture', 'Bientôt'],
            ['Notification sous seuil', 'Bientôt'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Ressources humaines">
        <PlaceholderGrid
          items={[
            ['Jours ouvrables par défaut', 'Bientôt'],
            ['Devise paie', company?.currency ?? 'USD'],
            ['Méthode salaire journalier', 'Bientôt'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <PlaceholderGrid
          items={[
            ['Email', 'Simulation locale'],
            ['WhatsApp', 'Simulation locale'],
            ['SMS', 'Simulation locale'],
            ['Préférences activation', 'Bientôt'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Sécurité">
        <PlaceholderGrid
          items={[
            ['Durée session', 'Bientôt'],
            ['Politique mot de passe', 'Bientôt'],
            ['Audit', 'Actif'],
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Référentiels">
        {!Object.keys(groupedReferences).length ? (
          <EmptyState message="Aucun référentiel disponible." />
        ) : (
          <div className="chart-grid">
            {Object.entries(groupedReferences).map(([label, items]) => (
              <article className="chart-card" key={label}>
                <h3>{label}</h3>
                <p>{items.slice(0, 4).map((item) => item.label).join(', ') || 'Aucune donnée'}</p>
                <small>{items.length} valeur(s)</small>
              </article>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Services complémentaires">
        <div className="chart-grid">
          {services.map((service) => (
            <article className="chart-card" key={service.title}>
              <h3>{service.title}</h3>
              <button className="secondary">{service.action}</button>
            </article>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Réservé éditeur">
        {!can('publisher_settings.read') ? (
          <EmptyState message="Accès réservé." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Paramètre avancé</th>
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
  if (!items?.length) return 'Bientôt';
  return `${items.length} valeur(s) disponibles`;
}
