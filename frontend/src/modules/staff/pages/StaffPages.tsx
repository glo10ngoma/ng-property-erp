import { ArrowLeft, Eye, FileSpreadsheet, Pencil, Plus, Printer, ReceiptText, RotateCcw, ScrollText, Trash2, WalletCards } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, LoadingState, Modal, PageHeader, SearchableSelect, SuccessMessage } from '../../../components';
import type { SearchableSelectOption } from '../../../components';
import { useApiList } from '../../../hooks';
import { StaffNav } from '../StaffNav';

type Employee = {
  id: number;
  employee_number?: string;
  first_name: string;
  last_name: string;
  post_name?: string;
  gender?: string;
  birth_date?: string;
  nationality?: string;
  marital_status?: string;
  phone?: string;
  secondary_phone?: string;
  email?: string;
  address?: string;
  service_id?: number | null;
  position_id?: number | null;
  job_title: string;
  department?: string;
  hire_date: string;
  contract_type?: string;
  assigned_site?: string;
  manager_name?: string;
  status: string;
  monthly_salary: number;
  payment_method?: string;
  bank_name?: string;
  account_number?: string;
  mobile_money_number?: string;
  id_document_type?: string;
  id_document_number?: string;
  identity_attachment_name?: string;
  cv_attachment_name?: string;
  signed_contract_attachment_name?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  internal_notes?: string;
  current_contract_number?: string;
  current_contract_type?: string;
  current_contract_end_date?: string;
  attendance_status_today?: string;
};

type EmployeeContract = {
  id: number;
  employee_id: number;
  employee_name?: string;
  contract_number: string;
  contract_type: string;
  start_date: string;
  end_date?: string;
  salary_amount: number;
  currency?: string;
  job_title?: string;
  department?: string;
  contract_file_name?: string;
  observations?: string;
  status: string;
};

type SalaryAdvance = {
  id: number;
  employee_id: number;
  employee_name: string;
  amount: number;
  advance_date: string;
  reason?: string;
  status: string;
  payment_method?: string;
  reference?: string;
  repayment_schedule?: string;
  observations?: string;
};

type LeaveRequest = {
  id: number;
  employee_id: number;
  employee_name: string;
  start_date: string;
  end_date: string;
  leave_type: string;
  reason?: string;
  status: string;
  attachment_file_name?: string;
  observations?: string;
};

type AttendanceRow = {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_number?: string;
  department?: string;
  job_title?: string;
  monthly_salary?: number;
  attendance_date?: string;
  check_in_time?: string;
  check_out_time?: string;
  late_minutes?: number;
  absence?: boolean;
  worked_hours?: number;
  month: number;
  year: number;
  working_days: number;
  present_days: number;
  paid_leave_days: number;
  sick_days: number;
  unjustified_absence_days: number;
  late_count?: number;
  overtime_hours?: number;
  absence_deduction?: number;
  estimated_net_salary?: number;
  status: string;
  observations?: string;
};

type Payroll = {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_number?: string;
  job_title?: string;
  department?: string;
  month: number;
  year: number;
  gross_salary: number;
  daily_salary?: number;
  working_days?: number;
  present_days?: number;
  paid_leave_days?: number;
  sick_days?: number;
  unjustified_absence_days?: number;
  late_count?: number;
  overtime_hours?: number;
  advances_total: number;
  deductions_total: number;
  absence_deduction?: number;
  bonus_amount?: number;
  net_salary: number;
  status: string;
  payment_date?: string;
};

type EmployeeDetail = Employee & {
  current_contract?: EmployeeContract | null;
  contracts: EmployeeContract[];
  advances: SalaryAdvance[];
  leaves: LeaveRequest[];
  payrolls: Payroll[];
  attendance: AttendanceRow[];
  latest_monthly_attendance?: AttendanceRow | null;
  documents: Array<{ type: string; file_name: string }>;
  timeline: Array<{ date: string; event: string; description: string }>;
  audit: Array<{ action: string; resource: string; resource_id: string; created_at: string }>;
};

type HrReport = {
  summary: {
    total_employees: number;
    active_employees: number;
    monthly_payroll: number;
    advances_open: number;
    contracts_expiring: number;
    absences: number;
    delays: number;
  };
  employees: Employee[];
  contracts: EmployeeContract[];
  advances: SalaryAdvance[];
  leaves: LeaveRequest[];
  attendance: AttendanceRow[];
  payrolls: Payroll[];
  by_department: Array<{ department: string; count: number }>;
  expiring_contracts: EmployeeContract[];
  current_month: string;
};

type HrService = {
  id: number;
  code?: string | null;
  name: string;
  description?: string | null;
  status: string;
};

type HrPosition = {
  id: number;
  code?: string | null;
  name: string;
  description?: string | null;
  status: string;
};

const employeeStatuses = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE'];
const contractTypes = ['CDI', 'CDD', 'Consultance', 'Stage', 'Prestation', 'Autre'];
const leaveTypes = ['Annuel', 'Maladie', 'Maternité', 'Paternité', 'Exceptionnel', 'Sans solde'];
const leaveStatuses = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const paymentMethods = ['CASH', 'BANK', 'MOBILE_MONEY'];
const genders = ['Masculin', 'Féminin'];
const maritalStatuses = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)'];

export function StaffPage() {
  return <Navigate to="/personnel/employees" replace />;
}

export function EmployeesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const employees = useApiList<Employee>('/employees');
  const services = useApiList<HrService>('/hr/services');
  const positions = useApiList<HrPosition>('/hr/positions');
  const advances = useApiList<SalaryAdvance>('/salary-advances');
  const leaves = useApiList<LeaveRequest>('/leaves');
  const payrolls = useApiList<Payroll>('/payrolls');
  const contracts = useApiList<EmployeeContract>('/employee-contracts');
  const attendance = useApiList<AttendanceRow>('/employee-attendance');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [status, setStatus] = useState('');
  const [contractType, setContractType] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState<number | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [success, setSuccess] = useState('');

  const departmentOptions = catalogFilterOptions(services.data, employees.data.map((row) => row.department));
  const jobOptions = catalogFilterOptions(positions.data, employees.data.map((row) => row.job_title));

  const filtered = useMemo(() => employees.data.filter((row) =>
    includesText({ ...row, full_name: employeeName(row) }, query)
      && (!department || row.department === department)
      && (!jobTitle || row.job_title === jobTitle)
      && (!status || row.status === status)
      && (!contractType || (row.current_contract_type ?? row.contract_type) === contractType),
  ), [employees.data, query, department, jobTitle, status, contractType]);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = employees.data.filter((row) => row.status === 'ACTIVE').length;
    const onLeave = employees.data.filter((row) => row.status === 'ON_LEAVE').length;
    const suspended = employees.data.filter((row) => row.status === 'SUSPENDED').length;
    const expiring = contracts.data.filter((row) => row.end_date && daysUntil(row.end_date) <= 45 && daysUntil(row.end_date) >= 0 && row.status === 'ACTIVE').length;
    const payrollMass = employees.data.filter((row) => row.status !== 'INACTIVE').reduce((sum, row) => sum + Number(row.monthly_salary ?? 0), 0);
    const openAdvances = advances.data.filter((row) => row.status !== 'PAID' && row.status !== 'REJECTED').length;
    const absentToday = attendance.data.filter((row) => row.attendance_date === today && (row.absence || row.status === 'ABSENT')).length;
    return { active, onLeave, suspended, expiring, payrollMass, openAdvances, absentToday };
  }, [employees.data, contracts.data, advances.data, attendance.data]);

  async function saveEmployee(form: FormData, current?: Employee | null) {
    const payload = employeePayload(form);
    if (current?.id) {
      await api.put(`/employees/${current.id}`, payload);
      setSuccess('Employé modifié.');
      setEditing(null);
    } else {
      await api.post('/employees', payload);
      setSuccess('Employé créé.');
      setCreateOpen(false);
    }
    employees.reload();
  }

  async function saveContract(form: FormData, employeeId?: number) {
    await api.post('/employee-contracts', contractPayload(form, employeeId));
    setSuccess('Contrat employé enregistré.');
    setContractOpen(null);
    contracts.reload();
    employees.reload();
  }

  async function saveAdvance(form: FormData, employeeId?: number) {
    await api.post('/salary-advances', advancePayload(form, employeeId));
    setSuccess('Avance enregistrée.');
    setAdvanceOpen(null);
    advances.reload();
  }

  async function saveLeave(form: FormData, employeeId?: number) {
    await api.post('/leaves', leavePayload(form, employeeId));
    setSuccess('Congé enregistré.');
    setLeaveOpen(null);
    leaves.reload();
  }

  async function deactivateEmployee(id: number) {
    await api.post(`/employees/${id}/deactivate`);
    setSuccess('Employé désactivé.');
    employees.reload();
  }

  return <section>
    <PageHeader title="Personnel / RH" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvel employé</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Total employés" value={employees.data.length} />
      <Kpi label="Actifs" value={kpis.active} />
      <Kpi label="En congé" value={kpis.onLeave} />
      <Kpi label="Suspendus" value={kpis.suspended} />
      <Kpi label="Contrats expirants" value={kpis.expiring} />
      <Kpi label="Masse salariale mensuelle" value={`${money(kpis.payrollMass)} USD`} />
      <Kpi label="Avances en cours" value={kpis.openAdvances} />
      <Kpi label="Absents aujourd'hui" value={kpis.absentToday} />
    </div>
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Service</option>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="">Fonction</option>{jobOptions.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option>{employeeStatuses.map((value) => <option key={value} value={value}>{employeeStatusLabel(value)}</option>)}</select>
      <select value={contractType} onChange={(event) => setContractType(event.target.value)}><option value="">Type contrat</option>{contractTypes.map((value) => <option key={value}>{value}</option>)}</select>
      <button className="secondary" onClick={() => { setQuery(''); setDepartment(''); setJobTitle(''); setStatus(''); setContractType(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('rh-employes.csv', filtered.map(exportEmployeeRow))}>CSV</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Employés.xlsx', [{ name: 'Employés', rows: filtered.map(exportEmployeeRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    {employees.loading ? <LoadingState /> : <div className="table-wrap">
      <table>
        <thead><tr><th>Matricule</th><th>Nom complet</th><th>Téléphone</th><th>Service</th><th>Fonction</th><th>Type contrat</th><th className="right">Salaire</th><th>Devise</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id} className="clickable-row" onClick={() => navigate(`/personnel/employees/${row.id}`)}>
          <td>{employeeCode(row.employee_number, row.id)}</td>
          <td>{employeeName(row)}</td>
          <td>{row.phone ?? '?'}</td>
          <td>{row.department ?? '?'}</td>
          <td>{row.job_title}</td>
          <td>{row.current_contract_type ?? row.contract_type ?? '?'}</td>
          <td className="right">{money(row.monthly_salary)}</td>
          <td>USD</td>
          <td>{employeeStatusLabel(row.status)}</td>
          <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
            <IconAction title="Voir" icon={<Eye size={15} />} onClick={() => navigate(`/personnel/employees/${row.id}`)} />
            {can('staff.update') && <IconAction title="Modifier" icon={<Pencil size={15} />} onClick={() => setEditing(row)} />}
            {can('staff.create') && <IconAction title="Nouveau contrat" icon={<ScrollText size={15} />} onClick={() => setContractOpen(row.id)} />}
            {can('payroll.create') && <IconAction title="Avance" icon={<WalletCards size={15} />} onClick={() => setAdvanceOpen(row.id)} />}
            {can('payroll.create') && <IconAction title="Congé" icon={<ReceiptText size={15} />} onClick={() => setLeaveOpen(row.id)} />}
            {can('staff.update') && row.status !== 'INACTIVE' && <IconAction title="Désactiver" danger icon={<Trash2 size={15} />} onClick={() => void deactivateEmployee(row.id)} />}
          </td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucun employé trouvé." />}
    </div>}

    {createOpen && <EmployeeModal title="Nouvel employé" services={services.data} positions={positions.data} onClose={() => setCreateOpen(false)} onSubmit={(form) => saveEmployee(form, null)} />}
    {editing && <EmployeeModal title="Modifier employé" employee={editing} services={services.data} positions={positions.data} onClose={() => setEditing(null)} onSubmit={(form) => saveEmployee(form, editing)} />}
    {contractOpen !== null && <ContractModal employees={employees.data} employeeId={contractOpen} onClose={() => setContractOpen(null)} onSubmit={saveContract} />}
    {advanceOpen !== null && <AdvanceModal employees={employees.data} employeeId={advanceOpen} onClose={() => setAdvanceOpen(null)} onSubmit={saveAdvance} />}
    {leaveOpen !== null && <LeaveModal employees={employees.data} employeeId={leaveOpen} onClose={() => setLeaveOpen(null)} onSubmit={saveLeave} />}
  </section>;
}

export function ServicesPage() {
  const { can } = useAuth();
  const list = useApiList<HrService>('/hr/services');
  const [editing, setEditing] = useState<HrService | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');

  async function save(form: FormData, current?: HrService | null) {
    const payload = hrCatalogPayload(form);
    if (current?.id) {
      await api.patch(`/hr/services/${current.id}`, payload);
      setEditing(null);
      setSuccess('Service RH modifié.');
    } else {
      await api.post('/hr/services', payload);
      setCreateOpen(false);
      setSuccess('Service RH créé.');
    }
    await list.reload();
  }

  async function remove(id: number) {
    await api.delete(`/hr/services/${id}`);
    setSuccess('Service RH désactivé.');
    await list.reload();
  }

  return <section>
    <PageHeader title="Services RH" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouveau service</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    {list.loading ? <LoadingState /> : <div className="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Nom</th><th>Description</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{list.data.map((row) => <tr key={row.id}>
          <td>{row.code ?? '?'}</td>
          <td>{row.name}</td>
          <td>{row.description ?? '?'}</td>
          <td>{row.status === 'ACTIVE' ? 'Actif' : 'Inactif'}</td>
          <td className="actions actions-compact">
            {can('staff.update') && <IconAction title="Modifier" icon={<Pencil size={15} />} onClick={() => setEditing(row)} />}
            {can('staff.update') && <IconAction title="Desactiver" danger icon={<Trash2 size={15} />} onClick={() => void remove(row.id)} />}
          </td>
        </tr>)}</tbody>
      </table>
      {!list.data.length && <EmptyState message="Aucun service RH." />}
    </div>}
    {createOpen && <HrCatalogModal title="Nouveau service" label="Service" onClose={() => setCreateOpen(false)} onSubmit={(form) => save(form, null)} />}
    {editing && <HrCatalogModal title="Modifier service" label="Service" item={editing} onClose={() => setEditing(null)} onSubmit={(form) => save(form, editing)} />}
  </section>;
}

export function PositionsPage() {
  const { can } = useAuth();
  const list = useApiList<HrPosition>('/hr/positions');
  const [editing, setEditing] = useState<HrPosition | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');

  async function save(form: FormData, current?: HrPosition | null) {
    const payload = hrCatalogPayload(form);
    if (current?.id) {
      await api.patch(`/hr/positions/${current.id}`, payload);
      setEditing(null);
      setSuccess('Fonction RH modifiée.');
    } else {
      await api.post('/hr/positions', payload);
      setCreateOpen(false);
      setSuccess('Fonction RH créée.');
    }
    await list.reload();
  }

  async function remove(id: number) {
    await api.delete(`/hr/positions/${id}`);
    setSuccess('Fonction RH désactivée.');
    await list.reload();
  }

  return <section>
    <PageHeader title="Fonctions RH" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvelle fonction</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    {list.loading ? <LoadingState /> : <div className="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Nom</th><th>Description</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{list.data.map((row) => <tr key={row.id}>
          <td>{row.code ?? '?'}</td>
          <td>{row.name}</td>
          <td>{row.description ?? '?'}</td>
          <td>{row.status === 'ACTIVE' ? 'Actif' : 'Inactif'}</td>
          <td className="actions actions-compact">
            {can('staff.update') && <IconAction title="Modifier" icon={<Pencil size={15} />} onClick={() => setEditing(row)} />}
            {can('staff.update') && <IconAction title="Desactiver" danger icon={<Trash2 size={15} />} onClick={() => void remove(row.id)} />}
          </td>
        </tr>)}</tbody>
      </table>
      {!list.data.length && <EmptyState message="Aucune fonction RH." />}
    </div>}
    {createOpen && <HrCatalogModal title="Nouvelle fonction" label="Fonction" onClose={() => setCreateOpen(false)} onSubmit={(form) => save(form, null)} />}
    {editing && <HrCatalogModal title="Modifier fonction" label="Fonction" item={editing} onClose={() => setEditing(null)} onSubmit={(form) => save(form, editing)} />}
  </section>;
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contractOpen, setContractOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const employees = useApiList<Employee>('/employees');

  async function load() {
    if (!id) {
      setError("Identifiant employe introuvable.");
      setDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get<EmployeeDetail>(`/employees/${id}`);
      setDetail(response.data);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setDetail(null);
      setError(Array.isArray(message) ? message.join(' | ') : message || "Impossible de charger la fiche employé.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function saveContract(form: FormData) {
    if (!detail) return;
    await api.post('/employee-contracts', contractPayload(form, detail.id));
    setSuccess('Contrat enregistré.');
    setContractOpen(false);
    await load();
  }

  async function saveAdvance(form: FormData) {
    if (!detail) return;
    await api.post('/salary-advances', advancePayload(form, detail.id));
    setSuccess('Avance enregistrée.');
    setAdvanceOpen(false);
    await load();
  }

  async function saveLeave(form: FormData) {
    if (!detail) return;
    await api.post('/leaves', leavePayload(form, detail.id));
    setSuccess('Congé enregistré.');
    setLeaveOpen(false);
    await load();
  }

  if (loading) return <section><PageHeader title="Fiche employé" /><StaffNav /><LoadingState /></section>;
  if (!detail) return <section>
    <PageHeader title="Fiche employé" />
    <StaffNav />
    <div className="actions-row">
      <button className="secondary" onClick={() => navigate('/personnel/employees')}><ArrowLeft size={16} />Retour</button>
    </div>
    <EmptyState message={error || "Employé introuvable."} />
  </section>;

  return <section>
    <PageHeader title={`Fiche employé - ${employeeName(detail)}`} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="actions-row">
      <button className="secondary" onClick={() => navigate('/personnel/employees')}><ArrowLeft size={16} />Retour</button>
      {can('staff.create') && <button className="secondary" onClick={() => setContractOpen(true)}><ScrollText size={15} />Nouveau contrat</button>}
      {can('payroll.create') && <button className="secondary" onClick={() => setAdvanceOpen(true)}><WalletCards size={15} />Avance</button>}
      {can('payroll.create') && <button className="secondary" onClick={() => setLeaveOpen(true)}><ReceiptText size={15} />Congé</button>}
      <button className="secondary" onClick={() => window.print()}><Printer size={15} />Imprimer fiche</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook(`Employé_${employeeCode(detail.employee_number, detail.id)}.xlsx`, employeeWorkbook(detail))}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="summary-band">
      <div className="summary-item"><span>Matricule</span><strong>{employeeCode(detail.employee_number, detail.id)}</strong></div>
      <div className="summary-item"><span>Nom</span><strong>{employeeName(detail)}</strong></div>
      <div className="summary-item"><span>Service</span><strong>{detail.department ?? '?'}</strong></div>
      <div className="summary-item"><span>Fonction</span><strong>{detail.job_title}</strong></div>
      <div className="summary-item"><span>Statut</span><strong>{employeeStatusLabel(detail.status)}</strong></div>
      <div className="summary-item"><span>Salaire</span><strong>{money(detail.monthly_salary)} USD</strong></div>
      <div className="summary-item"><span>Contrat actuel</span><strong>{detail.current_contract?.contract_number ?? '?'}</strong></div>
    </div>
    <div className="mini-stats">
      <Kpi label="Avances" value={detail.advances.length} />
      <Kpi label="Congés" value={detail.leaves.length} />
      <Kpi label="Pointages" value={detail.attendance.length} />
      <Kpi label="Paies" value={detail.payrolls.length} />
      <Kpi label="Documents" value={detail.documents.length} />
      <Kpi label="Timeline" value={detail.timeline.length} />
    </div>
    <Section title="Identité">
      <div className="detail-list">
        <span>Prénom</span><strong>{detail.first_name}</strong>
        <span>Nom</span><strong>{detail.last_name}</strong>
        <span>Post-nom</span><strong>{detail.post_name ?? '?'}</strong>
        <span>Sexe</span><strong>{detail.gender ?? '?'}</strong>
        <span>Date de naissance</span><strong>{detail.birth_date ? shortDate(detail.birth_date) : '?'}</strong>
        <span>Nationalité</span><strong>{detail.nationality ?? '?'}</strong>
        <span>État civil</span><strong>{detail.marital_status ?? '?'}</strong>
      </div>
    </Section>
    <Section title="Contact">
      <div className="detail-list">
        <span>Téléphone</span><strong>{detail.phone ?? '?'}</strong>
        <span>Téléphone secondaire</span><strong>{detail.secondary_phone ?? '?'}</strong>
        <span>Email</span><strong>{detail.email ?? '?'}</strong>
        <span>Adresse</span><strong>{detail.address ?? '?'}</strong>
      </div>
    </Section>
    <Section title="Poste et paie">
      <div className="detail-list">
        <span>Service</span><strong>{detail.department ?? '?'}</strong>
        <span>Fonction</span><strong>{detail.job_title}</strong>
        <span>Date d’embauche</span><strong>{shortDate(detail.hire_date)}</strong>
        <span>Type contrat</span><strong>{detail.contract_type ?? detail.current_contract?.contract_type ?? '?'}</strong>
        <span>Site affecté</span><strong>{detail.assigned_site ?? '?'}</strong>
        <span>Manager</span><strong>{detail.manager_name ?? '?'}</strong>
        <span>Mode paiement</span><strong>{paymentMethodLabel(detail.payment_method)}</strong>
        <span>Banque</span><strong>{detail.bank_name ?? '?'}</strong>
        <span>Dernier pointage</span><strong>{detail.latest_monthly_attendance ? `${monthLabel(detail.latest_monthly_attendance.month)} ${detail.latest_monthly_attendance.year} - ${attendanceStatusLabel(detail.latest_monthly_attendance.status)}` : '?'}</strong>
        <span>Net estimé</span><strong>{detail.latest_monthly_attendance ? `${money(detail.latest_monthly_attendance.estimated_net_salary ?? 0)} USD` : '?'}</strong>
      </div>
    </Section>
    <Section title="Contrat actuel">
      {detail.current_contract ? <SimpleTable headers={['N° contrat', 'Type', 'Début', 'Fin', 'Salaire', 'Devise', 'Statut']} rows={[
        [detail.current_contract.contract_number, detail.current_contract.contract_type, shortDate(detail.current_contract.start_date), detail.current_contract.end_date ? shortDate(detail.current_contract.end_date) : '?', money(detail.current_contract.salary_amount), detail.current_contract.currency ?? 'USD', contractStatusLabel(detail.current_contract)],
      ]} /> : <CompactEmpty message="Aucun contrat actif." />}
    </Section>
    <Section title="Avances">
      {detail.advances.length ? <SimpleTable headers={['Date', 'Montant', 'Statut', 'Motif']} rows={detail.advances.map((row) => [shortDate(row.advance_date), `${money(row.amount)} USD`, advanceStatusLabel(row.status), row.reason ?? '?'])} /> : <CompactEmpty message="Aucune avance enregistrée." />}
    </Section>
    <Section title="Congés">
      {detail.leaves.length ? <SimpleTable headers={['Début', 'Fin', 'Type', 'Statut']} rows={detail.leaves.map((row) => [shortDate(row.start_date), shortDate(row.end_date), row.leave_type, leaveStatusLabel(row.status)])} /> : <CompactEmpty message="Aucun congé enregistré." />}
    </Section>
    <Section title="Pointages mensuels">
      {detail.attendance.length ? <SimpleTable headers={['PPériode', 'Présence', 'Congés', 'Maladie', 'Absences', 'Retards', 'Retenue', 'Net estimé', 'Statut']} rows={detail.attendance.map((row) => [`${monthLabel(row.month)} ${row.year}`, `${row.present_days}/${row.working_days}`, row.paid_leave_days, row.sick_days, row.unjustified_absence_days, row.late_count ?? 0, `${money(row.absence_deduction ?? 0)} USD`, `${money(row.estimated_net_salary ?? 0)} USD`, attendanceStatusLabel(row.status)])} /> : <CompactEmpty message="Aucun pointage mensuel enregistré." />}
    </Section>
    <Section title="Paies">
      {detail.payrolls.length ? <SimpleTable headers={['PPériode', 'Brut', 'Avances', 'Retenues', 'Net', 'Statut']} rows={detail.payrolls.map((row) => [`${monthLabel(row.month)} ${row.year}`, `${money(row.gross_salary)} USD`, `${money(row.advances_total)} USD`, `${money(row.deductions_total)} USD`, `${money(row.net_salary)} USD`, payrollStatusLabel(row.status)])} /> : <CompactEmpty message="Aucune paie générée." />}
    </Section>
    <Section title="Documents">
      {detail.documents.length ? <SimpleTable headers={['Type', 'Fichier']} rows={detail.documents.map((row) => [row.type, row.file_name])} /> : <CompactEmpty message="Aucun document RH." />}
    </Section>
    <Section title="Timeline">
      {detail.timeline.length ? <div className="timeline-list">{detail.timeline.map((row, index) => <div className="timeline-item" key={`${row.event}-${index}`}><span>{shortDate(row.date)}</span><strong>{row.event} - {row.description}</strong></div>)}</div> : <CompactEmpty message="Aucun historique disponible." />}
    </Section>
    <Section title="Audit">
      {detail.audit.length ? <SimpleTable headers={['Date', 'Action', 'Ressource']} rows={detail.audit.map((row) => [shortDate(row.created_at), row.action, `${row.resource} #${row.resource_id}`])} /> : <CompactEmpty message="Aucun audit trouvé." />}
    </Section>

    {contractOpen && <ContractModal employees={employees.data} employeeId={detail.id} onClose={() => setContractOpen(false)} onSubmit={saveContract} />}
    {advanceOpen && <AdvanceModal employees={employees.data} employeeId={detail.id} onClose={() => setAdvanceOpen(false)} onSubmit={saveAdvance} />}
    {leaveOpen && <LeaveModal employees={employees.data} employeeId={detail.id} onClose={() => setLeaveOpen(false)} onSubmit={saveLeave} />}
  </section>;
}

export function ContractsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const contracts = useApiList<EmployeeContract>('/employee-contracts');
  const employees = useApiList<Employee>('/employees');
  const [query, setQuery] = useState('');
  const [building, setBuilding] = useState('');
  const [status, setStatus] = useState('');
  const [contractType, setContractType] = useState('');
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');

  const filtered = useMemo(() => contracts.data.filter((row) =>
    includesText({ ...row, employee_name: row.employee_name ?? '' }, query)
      && (!status || contractLifecycleStatus(row) === status)
      && (!contractType || row.contract_type === contractType)
      && (!expiringSoon || contractLifecycleStatus(row) === 'EXPIRING'),
  ), [contracts.data, query, status, contractType, expiringSoon]);

  async function saveContract(form: FormData) {
    await api.post('/employee-contracts', contractPayload(form));
    setSuccess('Contrat employé enregistré.');
    setCreateOpen(false);
    contracts.reload();
  }

  return <section>
    <PageHeader title="Contrats RH" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouveau contrat</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Total contrats" value={contracts.data.length} />
      <Kpi label="Actifs" value={contracts.data.filter((row) => contractLifecycleStatus(row) === 'ACTIVE').length} />
      <Kpi label="Expirants" value={contracts.data.filter((row) => contractLifecycleStatus(row) === 'EXPIRING').length} />
      <Kpi label="Expirés" value={contracts.data.filter((row) => contractLifecycleStatus(row) === 'EXPIRED').length} />
      <Kpi label="Résiliés" value={contracts.data.filter((row) => contractLifecycleStatus(row) === 'TERMINATED').length} />
    </div>
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={contractType} onChange={(event) => setContractType(event.target.value)}><option value="">Type contrat</option>{contractTypes.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="ACTIVE">Actif</option><option value="EXPIRING">Expirant</option><option value="EXPIRED">Expiré</option><option value="TERMINATED">Résilié</option></select>
      <label className="checkbox-filter"><input type="checkbox" checked={expiringSoon} onChange={(event) => setExpiringSoon(event.target.checked)} />Bail expirant bientôt</label>
      <div />
      <button className="secondary" onClick={() => { setQuery(''); setBuilding(''); setStatus(''); setContractType(''); setExpiringSoon(false); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Contrats.xlsx', [{ name: 'Contrats', rows: filtered.map(exportContractRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>N° contrat</th><th>Employé</th><th>Type contrat</th><th>Date début</th><th>Date fin</th><th className="right">Salaire</th><th>Devise</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id} className="clickable-row" onClick={() => navigate(`/personnel/employees/${row.employee_id}`)}>
          <td>{row.contract_number}</td><td>{row.employee_name ?? `Employé #${row.employee_id}`}</td><td>{row.contract_type}</td><td>{shortDate(row.start_date)}</td><td>{row.end_date ? shortDate(row.end_date) : '?'}</td><td className="right">{money(row.salary_amount)}</td><td>{row.currency ?? 'USD'}</td><td>{contractStatusLabel(row)}</td>
          <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}><IconAction title="Voir" icon={<Eye size={15} />} onClick={() => navigate(`/personnel/employees/${row.employee_id}`)} /></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucun contrat RH." />}
    </div>
    {createOpen && <ContractModal employees={employees.data} onClose={() => setCreateOpen(false)} onSubmit={saveContract} />}
  </section>;
}

export function AdvancesPage() {
  const { can } = useAuth();
  const advances = useApiList<SalaryAdvance>('/salary-advances');
  const employees = useApiList<Employee>('/employees');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');
  const filtered = useMemo(() => advances.data.filter((row) => includesText(row, query) && (!status || row.status === status)), [advances.data, query, status]);

  async function saveAdvance(form: FormData) {
    await api.post('/salary-advances', advancePayload(form));
    setSuccess('Avance enregistrée.');
    setCreateOpen(false);
    advances.reload();
  }

  async function action(id: number, type: 'approve' | 'reject' | 'pay') {
    await api.post(`/salary-advances/${id}/${type}`, {});
    setSuccess(type === 'pay' ? 'Avance payée.' : `Avance ${type === 'approve' ? 'approuvée' : 'rejetée'}.`);
    advances.reload();
  }

  return <section>
    <PageHeader title="Avances sur salaire" action={can('payroll.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvelle avance</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="PENDING">Demandé</option><option value="APPROVED">Approuvé</option><option value="REJECTED">Refusé</option><option value="PAID">Payé</option></select>
      <div /><div /><div />
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Avances.xlsx', [{ name: 'Avances', rows: filtered.map(exportAdvanceRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>N° avance</th><th>Employé</th><th>Date</th><th className="right">Montant</th><th className="right">Montant remboursé</th><th className="right">Solde</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}><td>{`ADV-${row.id}`}</td><td>{row.employee_name}</td><td>{shortDate(row.advance_date)}</td><td className="right">{money(row.amount)}</td><td className="right">{row.status === 'PAID' ? money(row.amount) : money(0)}</td><td className="right">{row.status === 'PAID' ? money(0) : money(row.amount)}</td><td>{advanceStatusLabel(row.status)}</td><td className="actions actions-compact">{can('payroll.update') && row.status !== 'APPROVED' && row.status !== 'PAID' && <IconAction title="Approuver" icon={<Eye size={15} />} onClick={() => void action(row.id, 'approve')} />}{can('payroll.update') && row.status !== 'REJECTED' && row.status !== 'PAID' && <IconAction title="Rejeter" danger icon={<Trash2 size={15} />} onClick={() => void action(row.id, 'reject')} />}{can('payroll.update') && row.status !== 'PAID' && <IconAction title="Payer" icon={<WalletCards size={15} />} onClick={() => void action(row.id, 'pay')} />}</td></tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucune avance enregistrée." />}
    </div>
    {createOpen && <AdvanceModal employees={employees.data} onClose={() => setCreateOpen(false)} onSubmit={saveAdvance} />}
  </section>;
}

export function LeavesPage() {
  const { can } = useAuth();
  const leaves = useApiList<LeaveRequest>('/leaves');
  const employees = useApiList<Employee>('/employees');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');
  const filtered = useMemo(() => leaves.data.filter((row) => includesText(row, query) && (!status || row.status === status)), [leaves.data, query, status]);

  async function saveLeave(form: FormData) {
    await api.post('/leaves', leavePayload(form));
    setSuccess('Congé enregistré.');
    setCreateOpen(false);
    leaves.reload();
  }

  async function action(id: number, type: 'approve' | 'reject' | 'cancel') {
    await api.post(`/leaves/${id}/${type}`, {});
    setSuccess('Statut congé mis à jour.');
    leaves.reload();
  }

  return <section>
    <PageHeader title="Congés" action={can('payroll.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouveau congé</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option>{leaveStatuses.map((value) => <option key={value} value={value}>{leaveStatusLabel(value)}</option>)}</select>
      <div /><div /><div />
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Congés.xlsx', [{ name: 'Congés', rows: filtered.map(exportLeaveRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>N° congé</th><th>Employé</th><th>Type congé</th><th>Date début</th><th>Date fin</th><th className="right">Jours</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}><td>{`LV-${row.id}`}</td><td>{row.employee_name}</td><td>{row.leave_type}</td><td>{shortDate(row.start_date)}</td><td>{shortDate(row.end_date)}</td><td className="right">{daysBetween(row.start_date, row.end_date)}</td><td>{leaveStatusLabel(row.status)}</td><td className="actions actions-compact">{can('payroll.update') && row.status !== 'APPROVED' && <IconAction title="Approuver" icon={<Eye size={15} />} onClick={() => void action(row.id, 'approve')} />}{can('payroll.update') && row.status !== 'REJECTED' && <IconAction title="Rejeter" danger icon={<Trash2 size={15} />} onClick={() => void action(row.id, 'reject')} />}{can('payroll.update') && row.status !== 'CANCELLED' && <IconAction title="Annuler" icon={<RotateCcw size={15} />} onClick={() => void action(row.id, 'cancel')} />}</td></tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucun congé enregistré." />}
    </div>
    {createOpen && <LeaveModal employees={employees.data} onClose={() => setCreateOpen(false)} onSubmit={saveLeave} />}
  </section>;
}

export function AttendancePage() {
  const { can } = useAuth();
  const attendance = useApiList<AttendanceRow>('/employee-attendance');
  const employees = useApiList<Employee>('/employees');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');
  const filtered = useMemo(() => attendance.data.filter((row) => includesText(row, query) && (!status || row.status === status)), [attendance.data, query, status]);

  async function saveAttendance(form: FormData) {
    await api.post('/employee-attendance', attendancePayload(form));
    setSuccess('Pointage enregistré.');
    setCreateOpen(false);
    attendance.reload();
  }

  return <section>
    <PageHeader title="Pointage" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Pointage manuel</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="PRESENT">Présent</option><option value="ABSENT">Absent</option><option value="LATE">Retard</option></select>
      <div /><div /><div />
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Pointage.xlsx', [{ name: 'Pointage', rows: filtered.map(exportAttendanceRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Employé</th><th>Heure entrée</th><th>Heure sortie</th><th className="right">Retard</th><th>Absence</th><th className="right">Heures travaillées</th><th>Statut</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}><td>{row.attendance_date ? shortDate(row.attendance_date) : '?'}</td><td>{row.employee_name}</td><td>{row.check_in_time ?? '?'}</td><td>{row.check_out_time ?? '?'}</td><td className="right">{row.late_minutes ?? 0} min</td><td>{row.absence ? 'Oui' : 'Non'}</td><td className="right">{Number(row.worked_hours ?? 0).toFixed(2)}</td><td>{attendanceStatusLabel(row.status, row.absence)}</td></tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucun pointage enregistré." />}
    </div>
    {createOpen && <AttendanceModal employees={employees.data} onClose={() => setCreateOpen(false)} onSubmit={saveAttendance} />}
  </section>;
}

export function PayrollPage() {
  const { can } = useAuth();
  const payrolls = useApiList<Payroll>('/payrolls');
  const employees = useApiList<Employee>('/employees');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [success, setSuccess] = useState('');
  const filtered = useMemo(() => payrolls.data.filter((row) => includesText(row, query) && (!status || row.status === status)), [payrolls.data, query, status]);

  async function generate(form: FormData) {
    await api.post('/payrolls/generate', payrollPayload(form));
    setSuccess('Paie générée.');
    setGenerateOpen(false);
    payrolls.reload();
  }

  async function action(id: number, type: 'validate' | 'pay') {
    await api.post(`/payrolls/${id}/${type}`, {});
    setSuccess(type === 'pay' ? 'Salaire payé.' : 'Paie validée.');
    payrolls.reload();
  }

  return <section>
    <PageHeader title="Paie" action={can('payroll.create') ? <button onClick={() => setGenerateOpen(true)}><Plus size={16} />Générer paie</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="VALIDATED">Validé</option><option value="PAID">Payé</option></select>
      <div /><div /><div />
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Paie.xlsx', [{ name: 'Paie', rows: filtered.map(exportPayrollRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>PPériode</th><th>Employé</th><th className="right">Salaire brut</th><th className="right">Avances</th><th className="right">Primes</th><th className="right">Retenues</th><th className="right">Net à payer</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}><td>{monthLabel(row.month)} {row.year}</td><td>{row.employee_name}</td><td className="right">{money(row.gross_salary)}</td><td className="right">{money(row.advances_total)}</td><td className="right">{money(0)}</td><td className="right">{money(row.deductions_total)}</td><td className="right">{money(row.net_salary)}</td><td>{payrollStatusLabel(row.status)}</td><td className="actions actions-compact">{can('payroll.update') && row.status === 'DRAFT' && <IconAction title="Valider" icon={<Eye size={15} />} onClick={() => void action(row.id, 'validate')} />}{can('payroll.update') && row.status !== 'PAID' && <IconAction title="Payer" icon={<WalletCards size={15} />} onClick={() => void action(row.id, 'pay')} />}</td></tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucune paie générée." />}
    </div>
    {generateOpen && <PayrollModal employees={employees.data} onClose={() => setGenerateOpen(false)} onSubmit={generate} />}
  </section>;
}

export function HrReportsPage() {
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [report, setReport] = useState<HrReport | null>(null);

  useEffect(() => {
    api.get<HrReport>('/hr/report', { params: { month, year } }).then((response) => setReport(response.data));
  }, [month, year]);

  if (!report) return <section><PageHeader title="Rapports RH" /><StaffNav /><LoadingState /></section>;

  const workbook = [
    { name: 'Resume', rows: [report.summary] },
    { name: 'Employés', rows: report.employees.map(exportEmployeeRow) },
    { name: 'Contrats', rows: report.contracts.map(exportContractRow) },
    { name: 'Avances', rows: report.advances.map(exportAdvanceRow) },
    { name: 'Congés', rows: report.leaves.map(exportLeaveRow) },
    { name: 'Pointage', rows: report.attendance.map(exportAttendanceRow) },
    { name: 'Paie', rows: report.payrolls.map(exportPayrollRow) },
    { name: 'Documents', rows: report.contracts.filter((row) => row.contract_file_name).map((row) => ({ employe: row.employee_name ?? '', contrat: row.contract_number, fichier: row.contract_file_name })) },
    { name: 'Audit', rows: report.expiring_contracts.map((row) => ({ employe: row.employee_name ?? '', contrat: row.contract_number, statut: contractStatusLabel(row), fin: row.end_date ? shortDate(row.end_date) : '?' })) },
  ];

  return <section>
    <PageHeader title="Rapports RH" />
    <StaffNav />
    <div className="maintenance-filter-bar hr-filter-bar">
      <select value={month} onChange={(event) => setMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthLabel(index + 1)}</option>)}</select>
      <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="Année" />
      <div /><div /><div />
      <button className="secondary" onClick={() => exportXlsxWorkbook(`RH_Rapport_${report.current_month}.xlsx`, workbook)}><FileSpreadsheet size={15} />Excel multi-onglets</button>
    </div>
    <div className="mini-stats">
      <Kpi label="Masse salariale par mois" value={`${money(report.summary.monthly_payroll)} USD`} />
      <Kpi label="Employés actifs" value={report.summary.active_employees} />
      <Kpi label="Contrats expirants" value={report.summary.contracts_expiring} />
      <Kpi label="Avances en cours" value={report.summary.advances_open} />
      <Kpi label="Absences" value={report.summary.absences} />
      <Kpi label="Retards" value={report.summary.delays} />
    </div>
    <Section title="Employés par service">
      <SimpleTable headers={['Service', 'Employés']} rows={report.by_department.map((row) => [row.department, row.count])} />
    </Section>
    <Section title="Contrats expirants">
      {report.expiring_contracts.length ? <SimpleTable headers={['Employé', 'Contrat', 'Fin', 'Statut']} rows={report.expiring_contracts.map((row) => [row.employee_name ?? '', row.contract_number, row.end_date ? shortDate(row.end_date) : '?', contractStatusLabel(row)])} /> : <CompactEmpty message="Aucun contrat expirant." />}
    </Section>
    <Section title="Avances en cours">
      <SimpleTable headers={['Employé', 'Date', 'Montant', 'Statut']} rows={report.advances.filter((row) => row.status !== 'PAID' && row.status !== 'REJECTED').map((row) => [row.employee_name, shortDate(row.advance_date), `${money(row.amount)} USD`, advanceStatusLabel(row.status)])} />
    </Section>
    <Section title="Congés par pPériode">
      <SimpleTable headers={['Employé', 'Début', 'Fin', 'Type', 'Statut']} rows={report.leaves.map((row) => [row.employee_name, shortDate(row.start_date), shortDate(row.end_date), row.leave_type, leaveStatusLabel(row.status)])} />
    </Section>
    <Section title="Absences et retards">
      <SimpleTable headers={['Employé', 'Date', 'Retard', 'Absence', 'Statut']} rows={report.attendance.map((row) => [row.attendance_date ? shortDate(row.attendance_date) : '?', `${row.employee_name}`, `${row.late_minutes ?? 0} min`, row.absence ? 'Oui' : 'Non', attendanceStatusLabel(row.status, row.absence)])} />
    </Section>
    <Section title="Paie par mois">
      <SimpleTable headers={['Employé', 'PPériode', 'Net', 'Statut']} rows={report.payrolls.map((row) => [row.employee_name, `${monthLabel(row.month)} ${row.year}`, `${money(row.net_salary)} USD`, payrollStatusLabel(row.status)])} />
    </Section>
  </section>;
}

function HrCatalogModal({ title, label, item, onClose, onSubmit }: { title: string; label: string; item?: HrService | HrPosition | null; onClose: () => void; onSubmit: (form: FormData) => void }) {
  return <Modal title={title} onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <div className="modal-section"><h3>{label}</h3><div className="maintenance-grid hr-form-grid">
        <label>Code<input name="code" defaultValue={item?.code ?? ''} /></label>
        <label>Nom *<input name="name" defaultValue={item?.name ?? ''} required /></label>
        <label>Statut<select name="status" defaultValue={item?.status ?? 'ACTIVE'}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
        <label className="wide-field">Description<textarea name="description" defaultValue={item?.description ?? ''} rows={4} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer</button></div>
    </form>
  </Modal>;
}
function EmployeeModal({ title, employee, services, positions, onClose, onSubmit }: { title: string; employee?: Employee | null; services?: HrService[]; positions?: HrPosition[]; onClose: () => void; onSubmit: (form: FormData) => void }) {
  const availableServices = services ?? [];
  const availablePositions = positions ?? [];
  const [serviceValue, setServiceValue] = useState(() => selectedCatalogValue(employee?.service_id, employee?.department));
  const [positionValue, setPositionValue] = useState(() => selectedCatalogValue(employee?.position_id, employee?.job_title));
  const serviceOptions = useMemo(() => catalogSelectOptions(availableServices, serviceValue, employee?.department), [availableServices, serviceValue, employee?.department]);
  const positionOptions = useMemo(() => catalogSelectOptions(availablePositions, positionValue, employee?.job_title), [availablePositions, positionValue, employee?.job_title]);
  const useServiceCatalog = serviceOptions.length > 0;
  const usePositionCatalog = positionOptions.length > 0;
  return <Modal title={title} onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <div className="modal-section"><h3>Identite</h3><div className="maintenance-grid hr-form-grid">
        <label className="locked-field">Matricule auto<input name="employee_number" defaultValue={employee?.employee_number ?? 'Automatique'} readOnly /></label>
        <label>Prénom *<input name="first_name" defaultValue={employee?.first_name} required /></label>
        <label>Nom *<input name="last_name" defaultValue={employee?.last_name} required /></label>
        <label>Post-nom<input name="post_name" defaultValue={employee?.post_name} /></label>
        <label>Sexe<select name="gender" defaultValue={employee?.gender ?? ''}><option value="">Sélectionner</option>{genders.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Date de naissance<input type="date" name="birth_date" defaultValue={employee?.birth_date?.slice(0, 10)} /></label>
        <label>Nationalité<input name="nationality" defaultValue={employee?.nationality} /></label>
        <label>État civil<select name="marital_status" defaultValue={employee?.marital_status ?? ''}><option value="">Sélectionner</option>{maritalStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div></div>
      <div className="modal-section"><h3>Contact</h3><div className="maintenance-grid hr-form-grid">
        <label>Téléphone *<input name="phone" defaultValue={employee?.phone} required /></label>
        <label>Téléphone secondaire<input name="secondary_phone" defaultValue={employee?.secondary_phone} /></label>
        <label>Email<input name="email" defaultValue={employee?.email} /></label>
        <label className="wide-field">Adresse<input name="address" defaultValue={employee?.address} /></label>
      </div></div>
      <div className="modal-section"><h3>Professionnel</h3><div className="maintenance-grid hr-form-grid">
        {useServiceCatalog ? (
          <>
            <label>Service *<select name="service_id" value={serviceValue} onChange={(event) => setServiceValue(event.target.value)} required><option value="">Sélectionner</option>{serviceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <input type="hidden" name="department" value={catalogFallbackLabel(serviceValue, availableServices, employee?.department)} />
          </>
        ) : (
          <>
            <label>Service *<input name="department" defaultValue={employee?.department ?? ''} required /></label>
            <input type="hidden" name="service_id" value="" />
          </>
        )}
        {usePositionCatalog ? (
          <>
            <label>Fonction *<select name="position_id" value={positionValue} onChange={(event) => setPositionValue(event.target.value)} required><option value="">Sélectionner</option>{positionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <input type="hidden" name="job_title" value={catalogFallbackLabel(positionValue, availablePositions, employee?.job_title)} />
          </>
        ) : (
          <>
            <label>Fonction *<input name="job_title" defaultValue={employee?.job_title ?? ''} required /></label>
            <input type="hidden" name="position_id" value="" />
          </>
        )}
        <label>Date d’embauche *<input type="date" name="hire_date" defaultValue={employee?.hire_date?.slice(0, 10)} required /></label>
        <label>Type contrat<select name="contract_type" defaultValue={employee?.contract_type ?? ''}><option value="">Sélectionner</option>{contractTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Site / immeuble affecté<input name="assigned_site" defaultValue={employee?.assigned_site} /></label>
        <label>Manager<input name="manager_name" defaultValue={employee?.manager_name} /></label>
        <label>Statut<select name="status" defaultValue={employee?.status ?? 'ACTIVE'}>{employeeStatuses.map((value) => <option key={value} value={value}>{employeeStatusLabel(value)}</option>)}</select></label>
      </div></div>
      <div className="modal-section"><h3>Paie</h3><div className="maintenance-grid hr-form-grid">
        <label>Salaire de base<input type="number" min="0" step="0.01" name="monthly_salary" defaultValue={employee?.monthly_salary ?? 0} /></label>
        <label className="locked-field">Devise USD<input value="USD" readOnly /></label>
        <label>Mode paiement<select name="payment_method" defaultValue={employee?.payment_method ?? ''}><option value="">Sélectionner</option>{paymentMethods.map((value) => <option key={value} value={value}>{paymentMethodLabel(value)}</option>)}</select></label>
        <label>Banque<input name="bank_name" defaultValue={employee?.bank_name} /></label>
        <label>Numéro compte<input name="account_number" defaultValue={employee?.account_number} /></label>
        <label>Mobile Money<input name="mobile_money_number" defaultValue={employee?.mobile_money_number} /></label>
      </div></div>
      <div className="modal-section"><h3>Documents</h3><div className="maintenance-grid hr-form-grid">
        <label>Type pièce<input name="id_document_type" defaultValue={employee?.id_document_type} /></label>
        <label>Numéro pièce<input name="id_document_number" defaultValue={employee?.id_document_number} /></label>
        <label>Pièce jointe identité<input type="file" name="identity_attachment_file" onChange={(event) => syncFileName(event, 'identity_attachment_name')} /><input type="hidden" name="identity_attachment_name" defaultValue={employee?.identity_attachment_name} /></label>
        <label>CV<input type="file" name="cv_attachment_file" onChange={(event) => syncFileName(event, 'cv_attachment_name')} /><input type="hidden" name="cv_attachment_name" defaultValue={employee?.cv_attachment_name} /></label>
        <label>Contrat signé<input type="file" name="signed_contract_attachment_file" onChange={(event) => syncFileName(event, 'signed_contract_attachment_name')} /><input type="hidden" name="signed_contract_attachment_name" defaultValue={employee?.signed_contract_attachment_name} /></label>
      </div></div>
      <div className="modal-section"><h3>Urgence</h3><div className="maintenance-grid hr-form-grid">
        <label>Contact urgence<input name="emergency_contact_name" defaultValue={employee?.emergency_contact_name} /></label>
        <label>Téléphone urgence<input name="emergency_contact_phone" defaultValue={employee?.emergency_contact_phone} /></label>
      </div></div>
      <div className="modal-section"><h3>Notes</h3><div className="form-grid"><label className="wide-field">Observations internes<textarea name="internal_notes" defaultValue={employee?.internal_notes} rows={4} /></label></div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer</button></div>
    </form>
  </Modal>;
}
function ContractModal({ employees, employeeId, onClose, onSubmit }: { employees: Employee[]; employeeId?: number | null; onClose: () => void; onSubmit: (form: FormData, employeeId?: number) => void }) {
  const options = employeeOptions(employees);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(employeeId ?? null);
  return <Modal title="Créer contrat employé" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); onSubmit(form, selectedEmployee); } }}>
      <div className="modal-section"><h3>Contrat</h3><div className="maintenance-grid hr-form-grid">
        <label className="locked-field">N° contrat auto<input readOnly value="CTR-000001" /></label>
        <label>Employé *<SearchableSelect options={options} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employé" emptyMessage="Aucun employé" /></label>
        <label>Type contrat<select name="contract_type" defaultValue="CDD">{contractTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Date début<input type="date" name="start_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Date fin<input type="date" name="end_date" /></label>
        <label>Salaire<input type="number" min="0" step="0.01" name="salary_amount" defaultValue="0" /></label>
        <label className="locked-field">Devise<input readOnly value="USD" /></label>
        <label>Fonction<input name="job_title" /></label>
        <label>Service<input name="department" /></label>
        <label>Fichier contrat<input type="file" name="contract_file" onChange={(event) => syncFileName(event, 'contract_file_name')} /><input type="hidden" name="contract_file_name" /></label>
        <label>Statut<select name="status" defaultValue="ACTIVE"><option value="ACTIVE">Actif</option><option value="TERMINATED">Résilié</option></select></label>
        <label className="wide-field">Observations<textarea name="observations" rows={3} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Enregistrer</button></div>
    </form>
  </Modal>;
}

function AdvanceModal({ employees, employeeId, onClose, onSubmit }: { employees: Employee[]; employeeId?: number | null; onClose: () => void; onSubmit: (form: FormData, employeeId?: number) => void }) {
  const options = employeeOptions(employees);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(employeeId ?? null);
  return <Modal title="Créer avance" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); onSubmit(form, selectedEmployee); } }}>
      <div className="modal-section"><h3>Avance salaire</h3><div className="maintenance-grid hr-form-grid">
        <label>Employé *<SearchableSelect options={options} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employé" emptyMessage="Aucun employé" /></label>
        <label>Date<input type="date" name="advance_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Montant<input type="number" min="0" step="0.01" name="amount" required /></label>
        <label>Mode paiement<select name="payment_method" defaultValue="BANK">{paymentMethods.map((value) => <option key={value} value={value}>{paymentMethodLabel(value)}</option>)}</select></label>
        <label>Référence<input name="reference" /></label>
        <label>Échéancier remboursement<input name="repayment_schedule" /></label>
        <label className="wide-field">Motif<textarea name="reason" rows={3} /></label>
        <label className="wide-field">Observations<textarea name="observations" rows={3} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Enregistrer</button></div>
    </form>
  </Modal>;
}

function LeaveModal({ employees, employeeId, onClose, onSubmit }: { employees: Employee[]; employeeId?: number | null; onClose: () => void; onSubmit: (form: FormData, employeeId?: number) => void }) {
  const options = employeeOptions(employees);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(employeeId ?? null);
  return <Modal title="Créer congé" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); onSubmit(form, selectedEmployee); } }}>
      <div className="modal-section"><h3>Congé</h3><div className="maintenance-grid hr-form-grid">
        <label>Employé *<SearchableSelect options={options} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employé" emptyMessage="Aucun employé" /></label>
        <label>Type congé<select name="leave_type" defaultValue="Annuel">{leaveTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Date début<input type="date" name="start_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Date fin<input type="date" name="end_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Statut<select name="status" defaultValue="PENDING"><option value="DRAFT">Brouillon</option><option value="PENDING">Demandé</option><option value="APPROVED">Approuvé</option><option value="REJECTED">Refusé</option><option value="CANCELLED">Annulé</option></select></label>
        <label>Pièce jointe<input type="file" name="attachment_file" onChange={(event) => syncFileName(event, 'attachment_file_name')} /><input type="hidden" name="attachment_file_name" /></label>
        <label className="wide-field">Motif<textarea name="reason" rows={3} /></label>
        <label className="wide-field">Observations<textarea name="observations" rows={3} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Enregistrer</button></div>
    </form>
  </Modal>;
}

function AttendanceModal({ employees, onClose, onSubmit }: { employees: Employee[]; onClose: () => void; onSubmit: (form: FormData) => void }) {
  const options = employeeOptions(employees);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [absence, setAbsence] = useState(false);
  return <Modal title="Pointage manuel" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); form.set('absence', String(absence)); onSubmit(form); } }}>
      <div className="modal-section"><h3>Pointage</h3><div className="maintenance-grid hr-form-grid">
        <label>Employé *<SearchableSelect options={options} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employé" emptyMessage="Aucun employé" /></label>
        <label>Date<input type="date" name="attendance_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Heure entrée<input type="time" name="check_in_time" /></label>
        <label>Heure sortie<input type="time" name="check_out_time" /></label>
        <label>Retard (min)<input type="number" min="0" name="late_minutes" defaultValue="0" /></label>
        <label>Heures travaillées<input type="number" step="0.25" min="0" name="worked_hours" defaultValue="0" /></label>
        <label>Statut<select name="status" defaultValue="PRESENT"><option value="PRESENT">Présent</option><option value="LATE">Retard</option><option value="ABSENT">Absent</option></select></label>
        <label className="checkbox-filter"><input type="checkbox" checked={absence} onChange={(event) => setAbsence(event.target.checked)} />Absence</label>
        <label className="wide-field">Notes<textarea name="notes" rows={3} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Enregistrer</button></div>
    </form>
  </Modal>;
}

function PayrollModal({ employees, onClose, onSubmit }: { employees: Employee[]; onClose: () => void; onSubmit: (form: FormData) => void }) {
  const options = employeeOptions(employees);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  return <Modal title="Générer paie" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); onSubmit(form); } }}>
      <div className="modal-section"><h3>Paie mensuelle</h3><div className="maintenance-grid hr-form-grid">
        <label>Employé *<SearchableSelect options={options} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employé" emptyMessage="Aucun employé" /></label>
        <label>Mois<select name="month" defaultValue={String(new Date().getMonth() + 1)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthLabel(index + 1)}</option>)}</select></label>
        <label>Année<input name="year" defaultValue={String(new Date().getFullYear())} /></label>
        <label>Salaire brut<input type="number" min="0" step="0.01" name="gross_salary" defaultValue="0" /></label>
        <label>Retenues<input type="number" min="0" step="0.01" name="deductions_total" defaultValue="0" /></label>
        <label>Statut<select name="status" defaultValue="DRAFT"><option value="DRAFT">Brouillon</option><option value="VALIDATED">Validé</option></select></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Générer</button></div>
    </form>
  </Modal>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="detail-section report-section"><h4>{title}</h4>{children}</div>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
  return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function IconAction({ title, icon, danger, onClick }: { title: string; icon: ReactNode; danger?: boolean; onClick: () => void }) {
  return <button type="button" className={danger ? 'icon-btn danger' : 'icon-btn'} title={title} onClick={onClick}>{icon}</button>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function CompactEmpty({ message }: { message: string }) {
  return <div className="compact-empty">{message}</div>;
}

function employeePayload(form: FormData) {
  return {
    employee_number: stringValue(form, 'employee_number'),
    first_name: stringValue(form, 'first_name'),
    last_name: stringValue(form, 'last_name'),
    post_name: optionalStringValue(form, 'post_name'),
    gender: optionalStringValue(form, 'gender'),
    birth_date: optionalStringValue(form, 'birth_date'),
    nationality: optionalStringValue(form, 'nationality'),
    marital_status: optionalStringValue(form, 'marital_status'),
    phone: stringValue(form, 'phone'),
    secondary_phone: optionalStringValue(form, 'secondary_phone'),
    email: optionalStringValue(form, 'email'),
    address: optionalStringValue(form, 'address'),
    service_id: parseCatalogValue(stringValue(form, 'service_id')),
    position_id: parseCatalogValue(stringValue(form, 'position_id')),
    department: stringValue(form, 'department'),
    job_title: stringValue(form, 'job_title'),
    hire_date: stringValue(form, 'hire_date'),
    contract_type: optionalStringValue(form, 'contract_type'),
    assigned_site: optionalStringValue(form, 'assigned_site'),
    manager_name: optionalStringValue(form, 'manager_name'),
    status: stringValue(form, 'status') || 'ACTIVE',
    monthly_salary: Number(form.get('monthly_salary') ?? 0),
    payment_method: optionalStringValue(form, 'payment_method'),
    bank_name: optionalStringValue(form, 'bank_name'),
    account_number: optionalStringValue(form, 'account_number'),
    mobile_money_number: optionalStringValue(form, 'mobile_money_number'),
    id_document_type: optionalStringValue(form, 'id_document_type'),
    id_document_number: optionalStringValue(form, 'id_document_number'),
    identity_attachment_name: optionalStringValue(form, 'identity_attachment_name'),
    cv_attachment_name: optionalStringValue(form, 'cv_attachment_name'),
    signed_contract_attachment_name: optionalStringValue(form, 'signed_contract_attachment_name'),
    emergency_contact_name: optionalStringValue(form, 'emergency_contact_name'),
    emergency_contact_phone: optionalStringValue(form, 'emergency_contact_phone'),
    internal_notes: optionalStringValue(form, 'internal_notes'),
  };
}

function contractPayload(form: FormData, employeeId?: number) {
  return {
    employee_id: Number(form.get('employee_id') ?? employeeId ?? 0),
    contract_type: stringValue(form, 'contract_type'),
    start_date: stringValue(form, 'start_date'),
    end_date: stringValue(form, 'end_date'),
    salary_amount: Number(form.get('salary_amount') ?? 0),
    currency: 'USD',
    job_title: stringValue(form, 'job_title'),
    department: stringValue(form, 'department'),
    contract_file_name: stringValue(form, 'contract_file_name'),
    observations: stringValue(form, 'observations'),
    status: stringValue(form, 'status') || 'ACTIVE',
  };
}

function advancePayload(form: FormData, employeeId?: number) {
  return {
    employee_id: Number(form.get('employee_id') ?? employeeId ?? 0),
    advance_date: stringValue(form, 'advance_date'),
    amount: Number(form.get('amount') ?? 0),
    reason: stringValue(form, 'reason'),
    payment_method: stringValue(form, 'payment_method'),
    reference: stringValue(form, 'reference'),
    repayment_schedule: stringValue(form, 'repayment_schedule'),
    observations: stringValue(form, 'observations'),
    status: 'DRAFT',
  };
}

function leavePayload(form: FormData, employeeId?: number) {
  return {
    employee_id: Number(form.get('employee_id') ?? employeeId ?? 0),
    leave_type: stringValue(form, 'leave_type'),
    start_date: stringValue(form, 'start_date'),
    end_date: stringValue(form, 'end_date'),
    reason: stringValue(form, 'reason'),
    observations: stringValue(form, 'observations'),
    attachment_file_name: stringValue(form, 'attachment_file_name'),
    status: stringValue(form, 'status') || 'PENDING',
  };
}

function attendancePayload(form: FormData) {
  return {
    employee_id: Number(form.get('employee_id') ?? 0),
    attendance_date: stringValue(form, 'attendance_date'),
    check_in_time: stringValue(form, 'check_in_time'),
    check_out_time: stringValue(form, 'check_out_time'),
    late_minutes: Number(form.get('late_minutes') ?? 0),
    absence: String(form.get('absence') ?? 'false') === 'true',
    worked_hours: Number(form.get('worked_hours') ?? 0),
    status: stringValue(form, 'status') || 'PRESENT',
    notes: stringValue(form, 'notes'),
  };
}

function payrollPayload(form: FormData) {
  return {
    employee_id: Number(form.get('employee_id') ?? 0),
    month: Number(form.get('month') ?? new Date().getMonth() + 1),
    year: Number(form.get('year') ?? new Date().getFullYear()),
    gross_salary: Number(form.get('gross_salary') ?? 0),
    deductions_total: Number(form.get('deductions_total') ?? 0),
    status: stringValue(form, 'status') || 'DRAFT',
  };
}

function stringValue(form: FormData, key: string) {
  return String(form.get(key) ?? '').trim();
}

function optionalStringValue(form: FormData, key: string) {
  const value = stringValue(form, key);
  return value || null;
}

function hrCatalogPayload(form: FormData) {
  return {
    code: stringValue(form, 'code'),
    name: stringValue(form, 'name'),
    description: stringValue(form, 'description'),
    status: stringValue(form, 'status') || 'ACTIVE',
  };
}
function parseCatalogValue(value?: string) {
  if (!value) return null;
  if (value.startsWith('legacy:')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function selectedCatalogValue(id?: number | null, fallbackLabel?: string) {
  if (id) return String(id);
  const fallback = String(fallbackLabel ?? '').trim();
  return fallback ? `legacy:${fallback}` : '';
}
function catalogSelectOptions(rows: Array<HrService | HrPosition>, selectedValue: string, fallbackLabel?: string) {
  const options = rows
    .filter((row) => row.status === 'ACTIVE' || String(row.id) === selectedValue)
    .map((row) => ({ value: String(row.id), label: row.code ? `${row.name} (${row.code})` : row.name }));
  if (selectedValue.startsWith('legacy:')) {
    const legacyLabel = selectedValue.slice(7) || String(fallbackLabel ?? '').trim();
    if (legacyLabel) {
      options.unshift({ value: selectedValue, label: `${legacyLabel} (historique)` });
    }
  }
  return options;
}
function catalogFallbackLabel(selectedValue: string, rows: Array<HrService | HrPosition>, fallbackLabel?: string) {
  if (selectedValue.startsWith('legacy:')) return selectedValue.slice(7);
  const selected = rows.find((row) => String(row.id) === selectedValue);
  if (selected) return selected.name;
  return String(fallbackLabel ?? '');
}
function catalogFilterOptions(rows: Array<HrService | HrPosition>, legacyValues: Array<string | undefined>) {
  return uniqueValues([
    ...rows.map((row) => row.name),
    ...legacyValues,
  ]);
}
function syncFileName(event: React.ChangeEvent<HTMLInputElement>, hiddenField: string) {
  const fileName = event.target.files?.[0]?.name ?? '';
  const form = event.currentTarget.form;
  const hidden = form?.elements.namedItem(hiddenField) as HTMLInputElement | null;
  if (hidden) hidden.value = fileName;
}

function employeeOptions(rows: Employee[]): SearchableSelectOption<number>[] {
  return rows.map((row) => ({
    value: row.id,
    label: `${employeeCode(row.employee_number, row.id)} - ${employeeName(row)}`,
    meta: [`Service : ${row.department ?? '-'}`, `Fonction : ${row.job_title ?? '-'}`, row.phone ? `Téléphone : ${row.phone}` : ''].filter(Boolean).join(' | '),
  }));
}

function employeeWorkbook(detail: EmployeeDetail) {
  return [
    { name: 'Informations', rows: [exportEmployeeRow(detail)] },
    { name: 'Contrats', rows: detail.contracts.map(exportContractRow) },
    { name: 'Avances', rows: detail.advances.map(exportAdvanceRow) },
    { name: 'Congés', rows: detail.leaves.map(exportLeaveRow) },
    { name: 'Pointage', rows: detail.attendance.map(exportAttendanceRow) },
    { name: 'Paie', rows: detail.payrolls.map(exportPayrollRow) },
    { name: 'Documents', rows: detail.documents },
    { name: 'Timeline', rows: detail.timeline },
    { name: 'Audit', rows: detail.audit },
  ];
}

function exportEmployeeRow(row: Employee) {
  return {
    matricule: employeeCode(row.employee_number, row.id),
    nom_complet: employeeName(row),
    telephone: row.phone ?? '',
    service: row.department ?? '',
    fonction: row.job_title,
    type_contrat: row.current_contract_type ?? row.contract_type ?? '',
    salaire: money(row.monthly_salary),
    devise: 'USD',
    statut: employeeStatusLabel(row.status),
  };
}

function employeeCode(value: string | undefined, id: number) {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(/(EMP-\d{6})/i);
  if (match) return match[1].toUpperCase();
  return `EMP-${String(id).padStart(6, '0')}`;
}

function exportContractRow(row: EmployeeContract) {
  return {
    numero_contrat: row.contract_number,
    employe: row.employee_name ?? `Employé #${row.employee_id}`,
    type_contrat: row.contract_type,
    debut: shortDate(row.start_date),
    fin: row.end_date ? shortDate(row.end_date) : '',
    salaire: money(row.salary_amount),
    devise: row.currency ?? 'USD',
    statut: contractStatusLabel(row),
  };
}

function exportAdvanceRow(row: SalaryAdvance) {
  return {
    numero_avance: `ADV-${row.id}`,
    employe: row.employee_name,
    date: shortDate(row.advance_date),
    montant: money(row.amount),
    montant_rembourse: row.status === 'PAID' ? money(row.amount) : money(0),
    solde: row.status === 'PAID' ? money(0) : money(row.amount),
    statut: advanceStatusLabel(row.status),
  };
}

function exportLeaveRow(row: LeaveRequest) {
  return {
    numero_conge: `LV-${row.id}`,
    employe: row.employee_name,
    type_conge: row.leave_type,
    debut: shortDate(row.start_date),
    fin: shortDate(row.end_date),
    jours: daysBetween(row.start_date, row.end_date),
    statut: leaveStatusLabel(row.status),
  };
}

function exportAttendanceRow(row: AttendanceRow) {
  return {
    date: row.attendance_date ? shortDate(row.attendance_date) : '',
    employe: row.employee_name,
    heure_entree: row.check_in_time ?? '',
    heure_sortie: row.check_out_time ?? '',
    retard: row.late_minutes ?? 0,
    absence: row.absence ? 'Oui' : 'Non',
    heures_travaillees: Number(row.worked_hours ?? 0).toFixed(2),
    statut: attendanceStatusLabel(row.status, row.absence),
  };
}

function exportPayrollRow(row: Payroll) {
  return {
    periode: `${monthLabel(row.month)} ${row.year}`,
    employe: row.employee_name,
    salaire_brut: money(row.gross_salary),
    avances: money(row.advances_total),
    retenues: money(row.deductions_total),
    net_a_payer: money(row.net_salary),
    statut: payrollStatusLabel(row.status),
  };
}

function employeeName(row: Pick<Employee, 'first_name' | 'last_name' | 'post_name'>) {
  return [row.first_name, row.post_name, row.last_name].filter(Boolean).join(' ');
}

function monthLabel(month: number) {
  return ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'][month - 1] ?? String(month);
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
}

function daysUntil(value: string) {
  const current = new Date();
  const target = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Math.floor((target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));
}

function daysBetween(start: string, end: string) {
  const diff = new Date(`${end.slice(0, 10)}T00:00:00`).getTime() - new Date(`${start.slice(0, 10)}T00:00:00`).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

function employeeStatusLabel(value?: string) {
  return ({ ACTIVE: 'Actif', ON_LEAVE: 'En congé', SUSPENDED: 'Suspendu', INACTIVE: 'Inactif' } as Record<string, string>)[value ?? ''] ?? value ?? '?';
}

function contractLifecycleStatus(row: EmployeeContract) {
  if (row.status === 'TERMINATED') return 'TERMINATED';
  if (!row.end_date) return 'ACTIVE';
  const remaining = daysUntil(row.end_date);
  if (remaining < 0) return 'EXPIRED';
  if (remaining <= 45) return 'EXPIRING';
  return 'ACTIVE';
}

function contractStatusLabel(row: EmployeeContract) {
  return ({ ACTIVE: 'Actif', EXPIRING: 'Expirant', EXPIRED: 'Expiré', TERMINATED: 'Résilié' } as Record<string, string>)[contractLifecycleStatus(row)] ?? row.status;
}

function advanceStatusLabel(value: string) {
  return ({ DRAFT: 'Brouillon', PENDING: 'Demandé', APPROVED: 'Approuvé', REJECTED: 'Refusé', PAID: 'Payé' } as Record<string, string>)[value] ?? value;
}

function leaveStatusLabel(value: string) {
  return ({ DRAFT: 'Brouillon', PENDING: 'Demandé', APPROVED: 'Approuvé', REJECTED: 'Refusé', CANCELLED: 'Annulé' } as Record<string, string>)[value] ?? value;
}

function attendanceStatusLabel(value?: string, absence?: boolean) {
  if (absence) return 'Absent';
  return ({ PRESENT: 'Présent', LATE: 'Retard', ABSENT: 'Absent' } as Record<string, string>)[value ?? ''] ?? value ?? 'Présent';
}

function payrollStatusLabel(value: string) {
  return ({ DRAFT: 'Brouillon', VALIDATED: 'Validé', PAID: 'Payé' } as Record<string, string>)[value] ?? value;
}

function paymentMethodLabel(value?: string) {
  return ({ CASH: 'Espèces', BANK: 'Banque', MOBILE_MONEY: 'Mobile Money' } as Record<string, string>)[value ?? ''] ?? value ?? '?';
}
