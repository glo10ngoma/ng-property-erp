import { Building2, FileCog, MapPin, Percent, Save, Settings2, ShieldCheck, User } from 'lucide-react';
import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, LoadingState, PageHeader, SuccessMessage } from '../../../components';

type CompanySettingsResponse = {
  logo_url?: string;
  invoice_logo_url?: string;
  signature_url?: string;
  stamp_url?: string;
  company_name?: string;
  legal_name?: string;
  company_legal_name?: string;
  company_legal_name_resolved?: string;
  company_acronym?: string;
  company_legal_form?: string;
  company_rccm?: string;
  company_national_id?: string;
  company_tax_id?: string;
  address?: string;
  company_address?: string;
  company_address_resolved?: string;
  company_commune?: string;
  company_city?: string;
  company_country?: string;
  phone?: string;
  email?: string;
  website?: string;
  legal_representative_name?: string;
  legal_representative_title?: string;
  currency?: string;
  language?: string;
  timezone?: string;
  invoice_footer?: string;
  paper_format?: string;
  invoice_bottom_text?: string;
  default_lease_duration_months?: number;
  default_notice_months?: number;
  default_guarantee_months?: number;
  default_signature_place?: string;
  default_lease_usage?: string;
  default_contract_template_code?: string;
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

type SettingsDraft = {
  company_name: string;
  legal_name: string;
  company_legal_name: string;
  company_acronym: string;
  company_legal_form: string;
  company_rccm: string;
  company_national_id: string;
  company_tax_id: string;
  company_address: string;
  company_commune: string;
  company_city: string;
  company_country: string;
  phone: string;
  email: string;
  website: string;
  legal_representative_name: string;
  legal_representative_title: string;
  currency: string;
  language: string;
  timezone: string;
  invoice_footer: string;
  paper_format: string;
  invoice_bottom_text: string;
  logo_url: string;
  invoice_logo_url: string;
  signature_url: string;
  stamp_url: string;
  default_lease_duration_months: string;
  default_notice_months: string;
  default_guarantee_months: string;
  default_signature_place: string;
  default_lease_usage: string;
  default_contract_template_code: string;
};

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

const today = () => new Date().toISOString().slice(0, 10);

const defaultSettingsDraft = (): SettingsDraft => ({
  company_name: '',
  legal_name: '',
  company_legal_name: '',
  company_acronym: '',
  company_legal_form: '',
  company_rccm: '',
  company_national_id: '',
  company_tax_id: '',
  company_address: '',
  company_commune: '',
  company_city: '',
  company_country: '',
  phone: '',
  email: '',
  website: '',
  legal_representative_name: '',
  legal_representative_title: '',
  currency: 'USD',
  language: 'fr',
  timezone: 'Africa/Kinshasa',
  invoice_footer: '',
  paper_format: 'A4',
  invoice_bottom_text: '',
  logo_url: '',
  invoice_logo_url: '',
  signature_url: '',
  stamp_url: '',
  default_lease_duration_months: '12',
  default_notice_months: '1',
  default_guarantee_months: '3',
  default_signature_place: 'Kinshasa',
  default_lease_usage: 'RESIDENTIAL',
  default_contract_template_code: 'LEASE_RESIDENTIAL',
});

export function SettingsPage() {
  const { can } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsDraft>(defaultSettingsDraft);
  const [references, setReferences] = useState<ReferenceData[]>([]);
  const [services, setServices] = useState<PublisherService[]>([]);
  const [restricted, setRestricted] = useState<RestrictedSetting[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [exchangeRateDraft, setExchangeRateDraft] = useState('');
  const [exchangeRateDateDraft, setExchangeRateDateDraft] = useState(today());
  const [savingSection, setSavingSection] = useState<'company' | 'location' | 'representative' | 'lease' | 'documents' | 'general' | 'rate' | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      const companyPromise = api.get<CompanySettingsResponse>('/settings/company');
      const referencesPromise = api.get<ReferenceData[]>('/reference-data');
      const servicesPromise = api.get<PublisherService[]>('/settings/publisher-services');
      const exchangeRatePromise = api.get<ExchangeRate | null>('/settings/exchange-rate');
      const restrictedPromise = can('publisher_settings.read')
        ? api.get<RestrictedSetting[]>('/settings/restricted')
        : Promise.resolve({ data: [] as RestrictedSetting[] });

      const [companyResult, referencesResult, servicesResult, exchangeRateResult, restrictedResult] = await Promise.allSettled([
        companyPromise,
        referencesPromise,
        servicesPromise,
        exchangeRatePromise,
        restrictedPromise,
      ]);

      if (!active) return;

      if (companyResult.status === 'fulfilled') {
        setSettings(normalizeSettings(companyResult.value.data));
      } else {
        setError(extractErrorMessage(companyResult.reason, 'Impossible de charger les paramètres de l’entreprise.'));
      }

      if (referencesResult.status === 'fulfilled') {
        setReferences(referencesResult.value.data);
      } else {
        setError((current) => current || extractErrorMessage(referencesResult.reason, 'Impossible de charger les référentiels.'));
      }

      if (servicesResult.status === 'fulfilled') {
        setServices(servicesResult.value.data);
      } else {
        setError((current) => current || extractErrorMessage(servicesResult.reason, 'Impossible de charger les services complémentaires.'));
      }

      if (exchangeRateResult.status === 'fulfilled') {
        const nextRate = exchangeRateResult.value.data ?? null;
        setExchangeRate(nextRate);
        setExchangeRateDraft(nextRate ? String(nextRate.rate) : '');
        setExchangeRateDateDraft(nextRate?.effectiveDate ?? today());
      } else {
        setExchangeRate(null);
        setExchangeRateDraft('');
        setExchangeRateDateDraft(today());
        setError((current) => current || extractErrorMessage(exchangeRateResult.reason, 'Impossible de charger le taux de change.'));
      }

      if (restrictedResult.status === 'fulfilled') {
        setRestricted(restrictedResult.value.data);
      } else {
        setError((current) => current || extractErrorMessage(restrictedResult.reason, 'Impossible de charger les paramètres réservés.'));
      }

      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [can]);

  const groupedReferences = useMemo(() => {
    return references.reduce<Record<string, ReferenceData[]>>((accumulator, item) => {
      const key = referenceTypeLabels[item.type] ?? item.type;
      accumulator[key] = [...(accumulator[key] ?? []), item];
      return accumulator;
    }, {});
  }, [references]);

  const companyDisabled = !can('settings.update') || savingSection === 'company';
  const locationDisabled = !can('settings.update') || savingSection === 'location';
  const representativeDisabled = !can('settings.update') || savingSection === 'representative';
  const leaseDisabled = !can('settings.update') || savingSection === 'lease';
  const documentsDisabled = !can('settings.update') || savingSection === 'documents';
  const generalDisabled = !can('settings.update') || savingSection === 'general';
  const rateDisabled = !can('settings.update') || savingSection === 'rate';

  function fieldProps<K extends keyof SettingsDraft>(key: K) {
    return {
      value: settings[key],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const value = event.target.value;
        setSettings((current) => ({ ...current, [key]: value }));
      },
    };
  }

  async function saveCompanySection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const companyLegalName = cleanText(settings.company_legal_name || settings.company_name);
    await saveSettingsSection(
      'company',
      {
        company_name: cleanText(settings.company_name),
        legal_name: companyLegalName,
        company_legal_name: companyLegalName,
        company_acronym: cleanText(settings.company_acronym),
        company_legal_form: cleanText(settings.company_legal_form),
        company_rccm: cleanText(settings.company_rccm),
        company_national_id: cleanText(settings.company_national_id),
        company_tax_id: cleanText(settings.company_tax_id),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          company_name: response.company_name ?? current.company_name,
          legal_name: response.legal_name ?? response.company_legal_name ?? current.legal_name,
          company_legal_name: response.company_legal_name ?? response.legal_name ?? current.company_legal_name,
          company_acronym: response.company_acronym ?? current.company_acronym,
          company_legal_form: response.company_legal_form ?? current.company_legal_form,
          company_rccm: response.company_rccm ?? current.company_rccm,
          company_national_id: response.company_national_id ?? current.company_national_id,
          company_tax_id: response.company_tax_id ?? current.company_tax_id,
        }));
      },
      'Informations du bailleur enregistrées.',
    );
  }

  async function saveLocationSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection(
      'location',
      {
        address: cleanText(settings.company_address),
        company_address: cleanText(settings.company_address),
        company_commune: cleanText(settings.company_commune),
        company_city: cleanText(settings.company_city),
        company_country: cleanText(settings.company_country),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          company_address: response.company_address ?? response.address ?? current.company_address,
          company_commune: response.company_commune ?? current.company_commune,
          company_city: response.company_city ?? current.company_city,
          company_country: response.company_country ?? current.company_country,
        }));
      },
      'Localisation enregistrée.',
    );
  }

  async function saveRepresentativeSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection(
      'representative',
      {
        phone: cleanText(settings.phone),
        email: cleanText(settings.email),
        website: cleanText(settings.website),
        legal_representative_name: cleanText(settings.legal_representative_name),
        legal_representative_title: cleanText(settings.legal_representative_title),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          phone: response.phone ?? current.phone,
          email: response.email ?? current.email,
          website: response.website ?? current.website,
          legal_representative_name: response.legal_representative_name ?? current.legal_representative_name,
          legal_representative_title: response.legal_representative_title ?? current.legal_representative_title,
        }));
      },
      'Représentant légal enregistré.',
    );
  }

  async function saveLeaseSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection(
      'lease',
      {
        default_lease_duration_months: toNumber(settings.default_lease_duration_months),
        default_notice_months: toNumber(settings.default_notice_months),
        default_guarantee_months: toNumber(settings.default_guarantee_months),
        default_signature_place: cleanText(settings.default_signature_place),
        default_lease_usage: cleanText(settings.default_lease_usage),
        default_contract_template_code: cleanText(settings.default_contract_template_code),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          default_lease_duration_months: String(response.default_lease_duration_months ?? current.default_lease_duration_months),
          default_notice_months: String(response.default_notice_months ?? current.default_notice_months),
          default_guarantee_months: String(response.default_guarantee_months ?? current.default_guarantee_months),
          default_signature_place: response.default_signature_place ?? current.default_signature_place,
          default_lease_usage: response.default_lease_usage ?? current.default_lease_usage,
          default_contract_template_code: response.default_contract_template_code ?? current.default_contract_template_code,
        }));
      },
      'Paramètres des baux enregistrés.',
    );
  }

  async function saveDocumentsSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection(
      'documents',
      {
        logo_url: cleanText(settings.logo_url),
        invoice_logo_url: cleanText(settings.invoice_logo_url),
        signature_url: cleanText(settings.signature_url),
        stamp_url: cleanText(settings.stamp_url),
        paper_format: cleanText(settings.paper_format),
        invoice_footer: cleanText(settings.invoice_footer),
        invoice_bottom_text: cleanText(settings.invoice_bottom_text),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          logo_url: response.logo_url ?? current.logo_url,
          invoice_logo_url: response.invoice_logo_url ?? current.invoice_logo_url,
          signature_url: response.signature_url ?? current.signature_url,
          stamp_url: response.stamp_url ?? current.stamp_url,
          paper_format: response.paper_format ?? current.paper_format,
          invoice_footer: response.invoice_footer ?? current.invoice_footer,
          invoice_bottom_text: response.invoice_bottom_text ?? current.invoice_bottom_text,
        }));
      },
      'Documents et impression enregistrés.',
    );
  }

  async function saveGeneralSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection(
      'general',
      {
        currency: cleanText(settings.currency),
        language: cleanText(settings.language),
        timezone: cleanText(settings.timezone),
      },
      (response) => {
        setSettings((current) => ({
          ...current,
          currency: response.currency ?? current.currency,
          language: response.language ?? current.language,
          timezone: response.timezone ?? current.timezone,
        }));
      },
      'Paramètres généraux enregistrés.',
    );
  }

  async function saveExchangeRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSavingSection('rate');
    try {
      const response = await api.patch<ExchangeRate>('/settings/exchange-rate', {
        rate: Number(exchangeRateDraft),
        effectiveDate: exchangeRateDateDraft,
      });
      const next = response.data ?? null;
      setExchangeRate(next);
      setExchangeRateDraft(next ? String(next.rate) : '');
      setExchangeRateDateDraft(next?.effectiveDate ?? today());
      setSuccess('Taux de change enregistré.');
    } catch (submissionError) {
      setError(extractErrorMessage(submissionError, 'Impossible d’enregistrer le taux de change.'));
    } finally {
      setSavingSection(null);
    }
  }

  async function saveSettingsSection(
    section: NonNullable<typeof savingSection>,
    payload: Record<string, unknown>,
    merge: (response: CompanySettingsResponse) => void,
    successMessage: string,
  ) {
    setError('');
    setSuccess('');
    setSavingSection(section);
    try {
      const response = await api.patch<CompanySettingsResponse>('/settings/company', payload);
      merge(response.data);
      setSuccess(successMessage);
    } catch (submissionError) {
      setError(extractErrorMessage(submissionError, 'Impossible d’enregistrer les paramètres.'));
    } finally {
      setSavingSection(null);
    }
  }

  if (loading) {
    return <LoadingState message="Chargement des paramètres..." />;
  }

  return (
    <section className="settings-page">
      <PageHeader title="Paramètres" />
      <p className="muted-text settings-intro">Centralisez les informations du bailleur, les paramètres des baux et le taux de change.</p>
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}
      <div className="summary-band">
        <div className="summary-item">
          <span>Bailleur</span>
          <strong>{settings.company_legal_name || settings.company_name || '-'}</strong>
        </div>
        <div className="summary-item">
          <span>Ville</span>
          <strong>{settings.company_city || '-'}</strong>
        </div>
        <div className="summary-item">
          <span>Devise</span>
          <strong>{settings.currency || 'USD'}</strong>
        </div>
        <div className="summary-item">
          <span>Taux USD/CDF</span>
          <strong>{exchangeRate?.rate ? `1 USD = ${exchangeRate.rate.toLocaleString('fr-FR')} CDF` : 'Non disponible'}</strong>
        </div>
      </div>

      <SettingsSection
        title="Entreprise / Bailleur"
        description="Informations juridiques utilisées dans les contrats, factures et documents officiels."
        icon={<Building2 size={16} />}
      >
        <form className="settings-grid" onSubmit={saveCompanySection}>
          <SettingField label="Nom commercial">
            <input {...fieldProps('company_name')} disabled={companyDisabled} required />
          </SettingField>
          <SettingField label="Raison sociale">
            <input {...fieldProps('company_legal_name')} disabled={companyDisabled} />
          </SettingField>
          <SettingField label="Sigle">
            <input {...fieldProps('company_acronym')} disabled={companyDisabled} />
          </SettingField>
          <SettingField label="Forme juridique">
            <input {...fieldProps('company_legal_form')} disabled={companyDisabled} />
          </SettingField>
          <SettingField label="RCCM">
            <input {...fieldProps('company_rccm')} disabled={companyDisabled} />
          </SettingField>
          <SettingField label="ID national">
            <input {...fieldProps('company_national_id')} disabled={companyDisabled} />
          </SettingField>
          <SettingField label="Numéro fiscal">
            <input {...fieldProps('company_tax_id')} disabled={companyDisabled} />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={companyDisabled}>
              <Save size={16} />
              {savingSection === 'company' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Localisation"
        description="Adresse et localisation administrative du bailleur."
        icon={<MapPin size={16} />}
      >
        <form className="settings-grid" onSubmit={saveLocationSection}>
          <SettingField label="Adresse">
            <input {...fieldProps('company_address')} disabled={locationDisabled} />
          </SettingField>
          <SettingField label="Commune">
            <input {...fieldProps('company_commune')} disabled={locationDisabled} />
          </SettingField>
          <SettingField label="Ville">
            <input {...fieldProps('company_city')} disabled={locationDisabled} />
          </SettingField>
          <SettingField label="Pays">
            <input {...fieldProps('company_country')} disabled={locationDisabled} />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={locationDisabled}>
              <Save size={16} />
              {savingSection === 'location' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Représentant légal"
        description="Nom et contact du signataire utilisé dans les contrats."
        icon={<User size={16} />}
      >
        <form className="settings-grid" onSubmit={saveRepresentativeSection}>
          <SettingField label="Nom du représentant">
            <input {...fieldProps('legal_representative_name')} disabled={representativeDisabled} />
          </SettingField>
          <SettingField label="Fonction">
            <input {...fieldProps('legal_representative_title')} disabled={representativeDisabled} />
          </SettingField>
          <SettingField label="Téléphone">
            <input {...fieldProps('phone')} disabled={representativeDisabled} />
          </SettingField>
          <SettingField label="Adresse e-mail">
            <input {...fieldProps('email')} disabled={representativeDisabled} />
          </SettingField>
          <SettingField label="Site web" wide>
            <input {...fieldProps('website')} disabled={representativeDisabled} />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={representativeDisabled}>
              <Save size={16} />
              {savingSection === 'representative' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Paramètres des baux"
        description="Valeurs par défaut reprises dans les nouveaux baux et contrats générés."
        icon={<FileCog size={16} />}
      >
        <form className="settings-grid" onSubmit={saveLeaseSection}>
          <SettingField label="Durée par défaut (mois)">
            <input {...fieldProps('default_lease_duration_months')} type="number" min="1" step="1" disabled={leaseDisabled} required />
          </SettingField>
          <SettingField label="Préavis par défaut (mois)">
            <input {...fieldProps('default_notice_months')} type="number" min="0" step="1" disabled={leaseDisabled} required />
          </SettingField>
          <SettingField label="Garantie par défaut (mois)">
            <input {...fieldProps('default_guarantee_months')} type="number" min="0" step="1" disabled={leaseDisabled} required />
          </SettingField>
          <SettingField label="Lieu de signature">
            <input {...fieldProps('default_signature_place')} disabled={leaseDisabled} />
          </SettingField>
          <SettingField label="Usage par défaut">
            <select {...fieldProps('default_lease_usage')} disabled={leaseDisabled}>
              <option value="RESIDENTIAL">Résidentiel</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="MIXED">Mixte</option>
            </select>
          </SettingField>
          <SettingField label="Modèle de contrat">
            <select {...fieldProps('default_contract_template_code')} disabled={leaseDisabled}>
              <option value="LEASE_RESIDENTIAL">Bail résidentiel</option>
              <option value="LEASE_COMMERCIAL">Bail commercial</option>
              <option value="LEASE_MIXED">Bail mixte</option>
            </select>
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={leaseDisabled}>
              <Save size={16} />
              {savingSection === 'lease' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Taux de change"
        description="Le taux USD/CDF est chargé au montage et réutilisé dans les paiements."
        icon={<Percent size={16} />}
      >
        <form className="settings-grid" onSubmit={saveExchangeRate}>
          <SettingField label="Devise de référence">
            <input value="USD" readOnly className="locked-field" />
          </SettingField>
          <SettingField label="Devise locale">
            <input value="CDF" readOnly className="locked-field" />
          </SettingField>
          <SettingField label="Taux de change">
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              value={exchangeRateDraft}
              onChange={(event) => setExchangeRateDraft(event.target.value)}
              disabled={rateDisabled}
              required
            />
          </SettingField>
          <SettingField label="Date d'effet">
            <input
              type="date"
              value={exchangeRateDateDraft}
              onChange={(event) => setExchangeRateDateDraft(event.target.value)}
              disabled={rateDisabled}
              required
            />
          </SettingField>
          <SettingField label="Dernière mise à jour">
            <input
              value={exchangeRate?.updatedAt ?? exchangeRate?.createdAt ?? '-'}
              readOnly
              className="locked-field"
            />
          </SettingField>
          <SettingField label="Aperçu">
            <input
              value={exchangeRate?.rate ? `1 USD = ${exchangeRate.rate.toLocaleString('fr-FR')} CDF` : 'Non disponible'}
              readOnly
              className="locked-field"
            />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={rateDisabled}>
              <Save size={16} />
              {savingSection === 'rate' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Documents et impression"
        description="Logos, signatures et mentions visibles dans les documents générés."
        icon={<Settings2 size={16} />}
      >
        <form className="settings-grid" onSubmit={saveDocumentsSection}>
          <SettingField label="Logo principal">
            <input {...fieldProps('logo_url')} disabled={documentsDisabled} />
          </SettingField>
          <SettingField label="Logo facture">
            <input {...fieldProps('invoice_logo_url')} disabled={documentsDisabled} />
          </SettingField>
          <SettingField label="Signature">
            <input {...fieldProps('signature_url')} disabled={documentsDisabled} />
          </SettingField>
          <SettingField label="Cachet">
            <input {...fieldProps('stamp_url')} disabled={documentsDisabled} />
          </SettingField>
          <SettingField label="Format papier">
            <select {...fieldProps('paper_format')} disabled={documentsDisabled}>
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="LETTER">Letter</option>
            </select>
          </SettingField>
          <SettingField label="Pied de facture" wide>
            <textarea {...fieldProps('invoice_footer')} disabled={documentsDisabled} rows={3} />
          </SettingField>
          <SettingField label="Texte bas de facture" wide>
            <textarea {...fieldProps('invoice_bottom_text')} disabled={documentsDisabled} rows={3} />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={documentsDisabled}>
              <Save size={16} />
              {savingSection === 'documents' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Paramètres généraux"
        description="Devise, langue et fuseau horaire de la plateforme."
        icon={<ShieldCheck size={16} />}
      >
        <form className="settings-grid" onSubmit={saveGeneralSection}>
          <SettingField label="Devise">
            <select {...fieldProps('currency')} disabled={generalDisabled}>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </SettingField>
          <SettingField label="Langue">
            <select {...fieldProps('language')} disabled={generalDisabled}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </SettingField>
          <SettingField label="Fuseau horaire">
            <input {...fieldProps('timezone')} disabled={generalDisabled} />
          </SettingField>
          <SettingActions>
            <button type="submit" disabled={generalDisabled}>
              <Save size={16} />
              {savingSection === 'general' ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </SettingActions>
        </form>
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
              <button className="secondary" type="button">
                {service.action}
              </button>
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

function normalizeSettings(data: CompanySettingsResponse): SettingsDraft {
  const defaults = defaultSettingsDraft();
  return {
    company_name: data.company_name ?? data.company_legal_name_resolved ?? defaults.company_name,
    legal_name: data.legal_name ?? data.company_legal_name ?? data.company_legal_name_resolved ?? defaults.legal_name,
    company_legal_name: data.company_legal_name ?? data.legal_name ?? data.company_legal_name_resolved ?? defaults.company_legal_name,
    company_acronym: data.company_acronym ?? defaults.company_acronym,
    company_legal_form: data.company_legal_form ?? defaults.company_legal_form,
    company_rccm: data.company_rccm ?? defaults.company_rccm,
    company_national_id: data.company_national_id ?? defaults.company_national_id,
    company_tax_id: data.company_tax_id ?? defaults.company_tax_id,
    company_address: data.company_address ?? data.address ?? data.company_address_resolved ?? defaults.company_address,
    company_commune: data.company_commune ?? defaults.company_commune,
    company_city: data.company_city ?? defaults.company_city,
    company_country: data.company_country ?? defaults.company_country,
    phone: data.phone ?? defaults.phone,
    email: data.email ?? defaults.email,
    website: data.website ?? defaults.website,
    legal_representative_name: data.legal_representative_name ?? defaults.legal_representative_name,
    legal_representative_title: data.legal_representative_title ?? defaults.legal_representative_title,
    currency: data.currency ?? defaults.currency,
    language: data.language ?? defaults.language,
    timezone: data.timezone ?? defaults.timezone,
    invoice_footer: data.invoice_footer ?? defaults.invoice_footer,
    paper_format: data.paper_format ?? defaults.paper_format,
    invoice_bottom_text: data.invoice_bottom_text ?? defaults.invoice_bottom_text,
    logo_url: data.logo_url ?? defaults.logo_url,
    invoice_logo_url: data.invoice_logo_url ?? defaults.invoice_logo_url,
    signature_url: data.signature_url ?? defaults.signature_url,
    stamp_url: data.stamp_url ?? defaults.stamp_url,
    default_lease_duration_months: String(data.default_lease_duration_months ?? 12),
    default_notice_months: String(data.default_notice_months ?? 1),
    default_guarantee_months: String(data.default_guarantee_months ?? 3),
    default_signature_place: data.default_signature_place ?? defaults.default_signature_place,
    default_lease_usage: data.default_lease_usage ?? defaults.default_lease_usage,
    default_contract_template_code: data.default_contract_template_code ?? defaults.default_contract_template_code,
  };
}

function cleanText(value: string) {
  return value.trim();
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.filter(Boolean).join(', ');
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function SettingsSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="detail-section settings-section">
      <div className="settings-section-head">
        <div>
          <h4>
            {icon}
            <span>{title}</span>
          </h4>
          {description ? <p className="muted-text settings-section-description">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SettingField({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`settings-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SettingActions({ children }: { children: ReactNode }) {
  return <div className="settings-actions">{children}</div>;
}
