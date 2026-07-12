import { Building2, FileCog, Image as ImageIcon, MapPin, Percent, Save, Settings2, ShieldCheck, Trash2, Upload, User } from 'lucide-react';
import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, LoadingState, PageHeader, SuccessMessage } from '../../../components';

type CompanySettingsResponse = {
  logo_url?: string;
  logo_file_name?: string;
  logo_file_url?: string;
  invoice_logo_url?: string;
  signature_url?: string;
  signature_file_name?: string;
  signature_file_url?: string;
  stamp_url?: string;
  stamp_file_name?: string;
  stamp_file_url?: string;
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
  logo_file_name: string;
  logo_file_url: string;
  invoice_logo_url: string;
  signature_file_name: string;
  signature_file_url: string;
  stamp_file_name: string;
  stamp_file_url: string;
  default_lease_duration_months: string;
  default_notice_months: string;
  default_guarantee_months: string;
  default_signature_place: string;
  default_lease_usage: string;
  default_contract_template_code: string;
};

const officialFileLabels = {
  logo: 'Logo',
  signature: 'Signature',
  stamp: 'Cachet',
} as const;

type OfficialFileKind = keyof typeof officialFileLabels;

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
  logo_file_name: '',
  logo_file_url: '',
  invoice_logo_url: '',
  signature_file_name: '',
  signature_file_url: '',
  stamp_file_name: '',
  stamp_file_url: '',
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
        setError(extractErrorMessage(companyResult.reason, "Impossible de charger les paramètres de l’entreprise."));
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

  async function refreshCompanySettings() {
    const response = await api.get<CompanySettingsResponse>('/settings/company');
    setSettings(normalizeSettings(response.data));
    return response.data;
  }

  async function refreshExchangeRate() {
    const response = await api.get<ExchangeRate | null>('/settings/exchange-rate');
    const nextRate = response.data ?? null;
    setExchangeRate(nextRate);
    setExchangeRateDraft(nextRate ? String(nextRate.rate) : '');
    setExchangeRateDateDraft(nextRate?.effectiveDate ?? today());
    return nextRate;
  }

  async function uploadOfficialFile(kind: OfficialFileKind, file: File) {
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post<CompanySettingsResponse>(`/settings/company-files/${kind}`, formData);
      setSettings(normalizeSettings(response.data));
      setSuccess(`${officialFileLabels[kind]} enregistré avec succès.`);
      return response.data;
    } catch (uploadError) {
      setError(extractErrorMessage(uploadError, `Impossible d'enregistrer le ${officialFileLabels[kind].toLowerCase()}.`));
      throw uploadError;
    }
  }

  async function deleteOfficialFile(kind: OfficialFileKind) {
    setError('');
    setSuccess('');
    try {
      const response = await api.delete<CompanySettingsResponse>(`/settings/company-files/${kind}`);
      setSettings(normalizeSettings(response.data));
      setSuccess(`${officialFileLabels[kind]} supprimé avec succès.`);
      return response.data;
    } catch (deleteError) {
      setError(extractErrorMessage(deleteError, `Impossible de supprimer le ${officialFileLabels[kind].toLowerCase()}.`));
      throw deleteError;
    }
  }

  async function saveCompanySection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const companyLegalName = cleanText(settings.company_legal_name || settings.company_name);
    await saveSettingsSection('company', {
      company_name: cleanText(settings.company_name),
      legal_name: companyLegalName,
      company_legal_name: companyLegalName,
      company_acronym: cleanText(settings.company_acronym),
      company_legal_form: cleanText(settings.company_legal_form),
      company_rccm: cleanText(settings.company_rccm),
      company_national_id: cleanText(settings.company_national_id),
      company_tax_id: cleanText(settings.company_tax_id),
    });
  }

  async function saveLocationSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection('location', {
      address: cleanText(settings.company_address),
      company_address: cleanText(settings.company_address),
      company_commune: cleanText(settings.company_commune),
      company_city: cleanText(settings.company_city),
      company_country: cleanText(settings.company_country),
    });
  }

  async function saveRepresentativeSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection('representative', {
      phone: cleanText(settings.phone),
      email: cleanText(settings.email),
      website: cleanText(settings.website),
      legal_representative_name: cleanText(settings.legal_representative_name),
      legal_representative_title: cleanText(settings.legal_representative_title),
    });
  }

  async function saveLeaseSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection('lease', {
      default_lease_duration_months: toNumber(settings.default_lease_duration_months),
      default_notice_months: toNumber(settings.default_notice_months),
      default_guarantee_months: toNumber(settings.default_guarantee_months),
      default_signature_place: cleanText(settings.default_signature_place),
      default_lease_usage: cleanText(settings.default_lease_usage),
      default_contract_template_code: cleanText(settings.default_contract_template_code),
    });
  }

  async function saveDocumentsSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection('documents', {
      invoice_logo_url: cleanText(settings.invoice_logo_url),
      paper_format: cleanText(settings.paper_format),
      invoice_footer: cleanText(settings.invoice_footer),
      invoice_bottom_text: cleanText(settings.invoice_bottom_text),
    });
  }

  async function saveGeneralSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSettingsSection('general', {
      currency: cleanText(settings.currency),
      language: cleanText(settings.language),
      timezone: cleanText(settings.timezone),
    });
  }

  async function saveExchangeRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSavingSection('rate');
    try {
      await api.patch<ExchangeRate>('/settings/exchange-rate', {
        rate: Number(exchangeRateDraft),
        effectiveDate: exchangeRateDateDraft,
      });
      await refreshExchangeRate();
      setSuccess('Paramètres enregistrés avec succès.');
    } catch (submissionError) {
      setError(extractErrorMessage(submissionError, "Impossible d’enregistrer le taux de change."));
    } finally {
      setSavingSection(null);
    }
  }

  async function saveSettingsSection(section: NonNullable<typeof savingSection>, payload: Record<string, unknown>) {
    setError('');
    setSuccess('');
    setSavingSection(section);
    try {
      await api.patch<CompanySettingsResponse>('/settings/company', payload);
      await refreshCompanySettings();
      setSuccess('Paramètres enregistrés avec succès.');
    } catch (submissionError) {
      setError(extractErrorMessage(submissionError, "Impossible d’enregistrer les paramètres."));
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

      <SettingsSection title="Localisation" description="Adresse et localisation administrative du bailleur." icon={<MapPin size={16} />}>
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
        description="Le taux USD/CDF est chargé au chargement de la page et réutilisé dans les paiements."
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
            <input value={exchangeRate?.updatedAt ?? exchangeRate?.createdAt ?? '-'} readOnly className="locked-field" />
          </SettingField>
          <SettingField label="Aperçu">
            <input
              value={Number(exchangeRateDraft) > 0 ? `1 USD = ${Number(exchangeRateDraft).toLocaleString('fr-FR')} CDF` : 'Non disponible'}
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
          <OfficialFileUpload
            kind="logo"
            title="Logo principal"
            description="Pièce jointe utilisée dans les documents officiels."
            fileName={settings.logo_file_name}
            fileUrl={settings.logo_file_url}
            disabled={documentsDisabled}
            onUpload={uploadOfficialFile}
            onDelete={deleteOfficialFile}
          />
          <SettingField label="Logo facture">
            <input {...fieldProps('invoice_logo_url')} disabled={documentsDisabled} />
          </SettingField>
          <OfficialFileUpload
            kind="signature"
            title="Signature"
            description="Signature officielle réutilisable dans les futurs documents."
            fileName={settings.signature_file_name}
            fileUrl={settings.signature_file_url}
            disabled={documentsDisabled}
            onUpload={uploadOfficialFile}
            onDelete={deleteOfficialFile}
          />
          <OfficialFileUpload
            kind="stamp"
            title="Cachet"
            description="Cachet officiel réutilisable dans les futurs documents."
            fileName={settings.stamp_file_name}
            fileUrl={settings.stamp_file_url}
            disabled={documentsDisabled}
            onUpload={uploadOfficialFile}
            onDelete={deleteOfficialFile}
          />
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

      <SettingsSection title="Services complémentaires" description="Zones non connectées à la V1, visibles à titre informatif uniquement.">
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

      <SettingsSection title="Réservé éditeur" description="Paramètres avancés non modifiables dans cette version.">
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
  const logoLegacyName = data.logo_url && data.logo_url !== data.logo_file_url ? extractFileName(data.logo_url) : '';
  const signatureLegacyName = data.signature_url && data.signature_url !== data.signature_file_url ? extractFileName(data.signature_url) : '';
  const stampLegacyName = data.stamp_url && data.stamp_url !== data.stamp_file_url ? extractFileName(data.stamp_url) : '';
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
    logo_file_name: data.logo_file_name ?? logoLegacyName ?? defaults.logo_file_name,
    logo_file_url: data.logo_file_url ?? data.logo_url ?? defaults.logo_file_url,
    invoice_logo_url: data.invoice_logo_url ?? defaults.invoice_logo_url,
    signature_file_name: data.signature_file_name ?? signatureLegacyName ?? defaults.signature_file_name,
    signature_file_url: data.signature_file_url ?? data.signature_url ?? defaults.signature_file_url,
    stamp_file_name: data.stamp_file_name ?? stampLegacyName ?? defaults.stamp_file_name,
    stamp_file_url: data.stamp_file_url ?? data.stamp_url ?? defaults.stamp_file_url,
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

function extractFileName(value?: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const withoutQuery = trimmed.split('?')[0];
    return decodeURIComponent(withoutQuery.split('/').pop() ?? '');
  } catch {
    return trimmed.split('?')[0].split('/').pop() ?? '';
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function inferFileType(fileName?: string | null, fileUrl?: string | null, mimeType?: string | null) {
  const source = `${mimeType ?? ''} ${fileName ?? ''} ${fileUrl ?? ''}`.toLowerCase();
  if (source.includes('png') || source.endsWith('.png')) return 'PNG';
  if (source.includes('jpeg') || source.endsWith('.jpg') || source.endsWith('.jpeg')) return 'JPEG';
  if (source.includes('svg') || source.endsWith('.svg')) return 'SVG';
  return 'Image';
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

function OfficialFileUpload({
  kind,
  title,
  description,
  fileName,
  fileUrl,
  disabled,
  onUpload,
  onDelete,
}: {
  kind: OfficialFileKind;
  title: string;
  description: string;
  fileName: string;
  fileUrl: string;
  disabled: boolean;
  onUpload: (kind: OfficialFileKind, file: File) => Promise<unknown>;
  onDelete: (kind: OfficialFileKind) => Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [remotePreviewUrl, setRemotePreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!selectedFile) {
      setObjectUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(selectedFile);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [selectedFile]);

  useEffect(() => {
    let active = true;
    let previewObjectUrl = '';

    async function loadRemotePreview() {
      if (!fileUrl || selectedFile) {
        if (active) setRemotePreviewUrl('');
        return;
      }
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        if (active) setRemotePreviewUrl(fileUrl);
        return;
      }
      const requestUrl = fileUrl.startsWith('/api/') ? fileUrl.slice(4) : fileUrl;
      try {
        const response = await api.get(requestUrl, { responseType: 'blob' });
        previewObjectUrl = URL.createObjectURL(response.data as Blob);
        if (active) setRemotePreviewUrl(previewObjectUrl);
      } catch {
        if (active) setRemotePreviewUrl('');
      }
    }

    void loadRemotePreview();
    return () => {
      active = false;
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
    };
  }, [fileUrl, selectedFile]);

  useEffect(() => {
    setSelectedFile(null);
    setLocalError('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [fileName, fileUrl]);

  const hasStoredFile = Boolean(fileName || fileUrl);
  const previewUrl = selectedFile ? objectUrl : remotePreviewUrl;
  const displayName = selectedFile ? selectedFile.name : hasStoredFile ? fileName || 'Fichier enregistré' : 'Aucun fichier';
  const displayType = inferFileType(selectedFile?.name, fileUrl, selectedFile?.type);
  const displaySize = selectedFile ? formatBytes(selectedFile.size) : hasStoredFile ? 'Taille non disponible' : '-';

  async function handleUpload() {
    if (!selectedFile) {
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      await onUpload(kind, selectedFile);
      setSelectedFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (uploadError) {
      setLocalError(extractErrorMessage(uploadError, 'Impossible de televerser le fichier.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedFile && !hasStoredFile) {
      return;
    }
    if (selectedFile && !hasStoredFile) {
      setSelectedFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      await onDelete(kind);
      setSelectedFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (deleteError) {
      setLocalError(extractErrorMessage(deleteError, 'Impossible de supprimer le fichier.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="company-file-card">
      <div className="company-file-head">
        <div>
          <h5>{title}</h5>
          <p className="muted-text">{description}</p>
        </div>
      </div>
      <div className="company-file-preview">
        {previewUrl ? <img src={previewUrl} alt={title} /> : <div className="company-file-placeholder"><ImageIcon size={30} /><span>Aucun fichier</span></div>}
      </div>
      <div className="company-file-meta">
        <div><span>Nom</span><strong>{displayName}</strong></div>
        <div><span>Type</span><strong>{displayType}</strong></div>
        <div><span>Taille</span><strong>{displaySize}</strong></div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
        hidden
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          setLocalError('');
          if (!next) {
            setSelectedFile(null);
            return;
          }
          if (next.size > 5 * 1024 * 1024) {
            setLocalError('Le fichier ne peut pas depasser 5 Mo.');
            event.currentTarget.value = '';
            return;
          }
          if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/jpg'].includes(next.type)) {
            setLocalError('Format de fichier non autorise.');
            event.currentTarget.value = '';
            return;
          }
          setSelectedFile(next);
        }}
      />
      <div className="company-file-actions">
        <button type="button" className="secondary" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
          <Upload size={14} />
          Choisir un fichier
        </button>
        <button type="button" onClick={() => void handleUpload()} disabled={disabled || busy || !selectedFile}>
          <Save size={14} />
          {busy ? 'Enregistrement...' : hasStoredFile ? 'Remplacer' : 'Téléverser'}
        </button>
        <button type="button" className="secondary" onClick={() => void handleDelete()} disabled={disabled || busy || (!selectedFile && !hasStoredFile)}>
          <Trash2 size={14} />
          Supprimer
        </button>
      </div>
      {localError ? <div className="error-message">{localError}</div> : null}
    </div>
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
