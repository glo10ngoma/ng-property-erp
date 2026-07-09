import { Eye, FileSpreadsheet, Plus, Printer, RotateCcw, WalletCards } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, exportXlsxWorkbook, includesText, money } from '../../../api';
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
  department?: string;
  job_title: string;
  monthly_salary: number;
};

type AttendanceRow = {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_number?: string;
  department?: string;
  job_title?: string;
  monthly_salary?: number;
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
  department?: string;
  job_title?: string;
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
  attendance: AttendanceRow[];
  payrolls: Payroll[];
  by_department: Array<{ department: string; count: number }>;
  current_month: string;
  advances: Array<{ employee_name: string; advance_date: string; amount: number; status: string }>;
  leaves: Array<{ employee_name: string; start_date: string; end_date: string; leave_type: string; status: string }>;
};

export function AttendancePage() {
  const { can } = useAuth();
  const employees = useApiList<Employee>('/employees');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [department, setDepartment] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');

  async function loadRows() {
    setLoading(true);
    const response = await api.get<AttendanceRow[]>('/employee-attendance', {
      params: {
        month: Number(month),
        year: Number(year),
        department: department || undefined,
        employee_id: employeeId || undefined,
      },
    });
    setRows(response.data);
    setLoading(false);
  }

  useEffect(() => {
    void loadRows();
  }, [month, year, department, employeeId]);

  const departmentOptions = uniqueValues(employees.data.map((row) => row.department));
  const filtered = useMemo(
    () => rows.filter((row) => includesText({ ...row, employee_name: row.employee_name }, query) && (!status || row.status === status)),
    [rows, query, status],
  );
  const totals = useMemo(
    () => ({
      employees: filtered.length,
      deductions: filtered.reduce((sum, row) => sum + Number(row.absence_deduction ?? 0), 0),
      estimatedNet: filtered.reduce((sum, row) => sum + Number(row.estimated_net_salary ?? 0), 0),
      absences: filtered.reduce((sum, row) => sum + Number(row.unjustified_absence_days ?? 0), 0),
      delays: filtered.reduce((sum, row) => sum + Number(row.late_count ?? 0), 0),
    }),
    [filtered],
  );

  async function saveAttendance(form: FormData) {
    await api.post('/employee-attendance', attendancePayload(form));
    setSuccess('Pointage mensuel enregistre.');
    setCreateOpen(false);
    await loadRows();
  }

  async function validateAttendance(id: number) {
    await api.post(`/employee-attendance/${id}/validate`, {});
    setSuccess('Pointage mensuel valide.');
    await loadRows();
  }

  return <section>
    <PageHeader title="Pointage mensuel" action={can('staff.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Saisir pointage mensuel</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Employes" value={totals.employees} />
      <Kpi label="Absences" value={totals.absences} />
      <Kpi label="Retards" value={totals.delays} />
      <Kpi label="Retenues" value={`${money(totals.deductions)} USD`} />
      <Kpi label="Net estime" value={`${money(totals.estimatedNet)} USD`} />
    </div>
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={month} onChange={(event) => setMonth(event.target.value)}>{monthOptions()}</select>
      <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="Annee" />
      <select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Service</option>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Employe</option>{employees.data.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="VALIDATED">Valide</option></select>
      <button className="secondary" onClick={() => { setQuery(''); setMonth(String(new Date().getMonth() + 1)); setYear(String(new Date().getFullYear())); setDepartment(''); setEmployeeId(''); setStatus(''); }}><RotateCcw size={15} />Reinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Pointage_Mensuel.xlsx', [{ name: 'Pointage', rows: filtered.map(exportAttendanceRow) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    {loading ? <LoadingState /> : <div className="table-wrap">
      <table>
        <thead><tr><th>Employe</th><th>Matricule</th><th>Service</th><th>Fonction</th><th className="right">Salaire mensuel</th><th className="right">Jours ouvrables</th><th className="right">Presents</th><th className="right">Conges payes</th><th className="right">Maladie</th><th className="right">Absences</th><th className="right">Retards</th><th className="right">Heures sup.</th><th className="right">Retenue abs.</th><th className="right">Net estime</th><th>Statut</th><th>Observations</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}>
          <td>{row.employee_name}</td>
          <td>{row.employee_number ?? `EMP-${row.employee_id}`}</td>
          <td>{row.department ?? '—'}</td>
          <td>{row.job_title ?? '—'}</td>
          <td className="right">{money(row.monthly_salary ?? 0)}</td>
          <td className="right">{row.working_days}</td>
          <td className="right">{row.present_days}</td>
          <td className="right">{row.paid_leave_days}</td>
          <td className="right">{row.sick_days}</td>
          <td className="right">{row.unjustified_absence_days}</td>
          <td className="right">{row.late_count ?? 0}</td>
          <td className="right">{Number(row.overtime_hours ?? 0).toFixed(2)}</td>
          <td className="right">{money(row.absence_deduction ?? 0)}</td>
          <td className="right">{money(row.estimated_net_salary ?? 0)}</td>
          <td>{attendanceStatusLabel(row.status)}</td>
          <td>{row.observations ?? '—'}</td>
          <td className="actions actions-compact">{can('staff.update') && row.status !== 'VALIDATED' && <IconAction title="Valider" icon={<Eye size={15} />} onClick={() => void validateAttendance(row.id)} />}</td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucun pointage mensuel trouve." />}
    </div>}
    {createOpen && <AttendanceModal employees={employees.data} onClose={() => setCreateOpen(false)} onSubmit={saveAttendance} defaultMonth={month} defaultYear={year} />}
  </section>;
}

export function PayrollPage() {
  const { can } = useAuth();
  const employees = useApiList<Employee>('/employees');
  const [rows, setRows] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [department, setDepartment] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null);
  const [success, setSuccess] = useState('');

  async function loadRows() {
    setLoading(true);
    const response = await api.get<Payroll[]>('/payrolls', {
      params: {
        month: Number(month),
        year: Number(year),
        department: department || undefined,
        status: status || undefined,
        employee_id: employeeId || undefined,
      },
    });
    setRows(response.data);
    setLoading(false);
  }

  useEffect(() => {
    void loadRows();
  }, [month, year, department, status, employeeId]);

  const departmentOptions = uniqueValues(employees.data.map((row) => row.department));
  const filtered = useMemo(
    () => rows.filter((row) => includesText({ ...row, employee_name: row.employee_name }, query)),
    [rows, query],
  );
  const kpis = useMemo(
    () => ({
      count: filtered.length,
      gross: filtered.reduce((sum, row) => sum + Number(row.gross_salary ?? 0), 0),
      deductions: filtered.reduce((sum, row) => sum + Number(row.deductions_total ?? 0), 0),
      advances: filtered.reduce((sum, row) => sum + Number(row.advances_total ?? 0), 0),
      net: filtered.reduce((sum, row) => sum + Number(row.net_salary ?? 0), 0),
      validated: filtered.filter((row) => row.status === 'VALIDATED').length,
      paid: filtered.filter((row) => row.status === 'PAID').length,
    }),
    [filtered],
  );

  async function generatePayroll(form: FormData) {
    await api.post('/payrolls/generate', payrollPayload(form));
    setSuccess('Paie du mois generee.');
    setGenerateOpen(false);
    await loadRows();
  }

  async function payrollAction(id: number, action: 'validate' | 'pay') {
    await api.post(`/payrolls/${id}/${action}`, {});
    setSuccess(action === 'pay' ? 'Paie marquee comme payee.' : 'Paie validee.');
    await loadRows();
    if (selectedPayroll?.id === id) {
      const response = await api.get<Payroll>(`/payrolls/${id}`);
      setSelectedPayroll(response.data);
    }
  }

  async function openPayroll(id: number) {
    const response = await api.get<Payroll>(`/payrolls/${id}`);
    setSelectedPayroll(response.data);
  }

  return <section>
    <PageHeader title="Paie mensuelle" action={can('payroll.create') ? <button onClick={() => setGenerateOpen(true)}><Plus size={16} />Generer paie du mois</button> : undefined} />
    <StaffNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Employes" value={kpis.count} />
      <Kpi label="Masse brute" value={`${money(kpis.gross)} USD`} />
      <Kpi label="Retenues" value={`${money(kpis.deductions)} USD`} />
      <Kpi label="Avances" value={`${money(kpis.advances)} USD`} />
      <Kpi label="Net a payer" value={`${money(kpis.net)} USD`} />
      <Kpi label="Validees" value={kpis.validated} />
      <Kpi label="Payees" value={kpis.paid} />
    </div>
    <div className="maintenance-filter-bar hr-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={month} onChange={(event) => setMonth(event.target.value)}>{monthOptions()}</select>
      <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="Annee" />
      <select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Service</option>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="VALIDATED">Validee</option><option value="PAID">Payee</option></select>
      <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Employe</option>{employees.data.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}</select>
      <button className="secondary" onClick={() => { setQuery(''); setMonth(String(new Date().getMonth() + 1)); setYear(String(new Date().getFullYear())); setDepartment(''); setStatus(''); setEmployeeId(''); }}><RotateCcw size={15} />Reinitialiser</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('RH_Paie_Mensuelle.xlsx', payrollWorkbook(filtered))}><FileSpreadsheet size={15} />Excel</button>
    </div>
    {loading ? <LoadingState /> : <div className="table-wrap">
      <table>
        <thead><tr><th>Matricule</th><th>Employe</th><th>Service</th><th>Fonction</th><th className="right">Salaire mensuel</th><th className="right">Retenues</th><th className="right">Avances</th><th className="right">Primes</th><th className="right">Net a payer</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={row.id}>
          <td>{row.employee_number ?? `EMP-${row.employee_id}`}</td>
          <td>{row.employee_name}</td>
          <td>{row.department ?? '—'}</td>
          <td>{row.job_title ?? '—'}</td>
          <td className="right">{money(row.gross_salary)}</td>
          <td className="right">{money(row.deductions_total)}</td>
          <td className="right">{money(row.advances_total)}</td>
          <td className="right">{money(row.bonus_amount ?? 0)}</td>
          <td className="right">{money(row.net_salary)}</td>
          <td>{payrollStatusLabel(row.status)}</td>
          <td className="actions actions-compact">
            <IconAction title="Voir fiche" icon={<Eye size={15} />} onClick={() => void openPayroll(row.id)} />
            {can('payroll.update') && row.status === 'DRAFT' && <IconAction title="Valider" icon={<FileSpreadsheet size={15} />} onClick={() => void payrollAction(row.id, 'validate')} />}
            {can('payroll.update') && row.status !== 'PAID' && <IconAction title="Marquer payee" icon={<WalletCards size={15} />} onClick={() => void payrollAction(row.id, 'pay')} />}
          </td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <EmptyState message="Aucune fiche de paie trouvee." />}
    </div>}
    {generateOpen && <PayrollModal employees={employees.data} onClose={() => setGenerateOpen(false)} onSubmit={generatePayroll} defaultMonth={month} defaultYear={year} />}
    {selectedPayroll && <PayrollDetailModal payroll={selectedPayroll} onClose={() => setSelectedPayroll(null)} onPay={() => void payrollAction(selectedPayroll.id, 'pay')} />}
  </section>;
}

export function HrReportsPage() {
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [report, setReport] = useState<HrReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<HrReport>('/hr/report', { params: { month, year } }).then((response) => {
      setReport(response.data);
      setLoading(false);
    });
  }, [month, year]);

  if (loading || !report) return <section><PageHeader title="Rapports RH" /><StaffNav /><LoadingState /></section>;

  return <section>
    <PageHeader title="Rapports RH" />
    <StaffNav />
    <div className="maintenance-filter-bar hr-filter-bar">
      <select value={month} onChange={(event) => setMonth(event.target.value)}>{monthOptions()}</select>
      <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="Annee" />
      <button className="secondary" onClick={() => exportXlsxWorkbook(`RH_Rapport_${report.current_month}.xlsx`, hrReportWorkbook(report))}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="mini-stats">
      <Kpi label="Masse salariale" value={`${money(report.summary.monthly_payroll)} USD`} />
      <Kpi label="Employes actifs" value={report.summary.active_employees} />
      <Kpi label="Absences" value={report.summary.absences} />
      <Kpi label="Retards" value={report.summary.delays} />
      <Kpi label="Avances ouvertes" value={report.summary.advances_open} />
      <Kpi label="Contrats expirants" value={report.summary.contracts_expiring} />
    </div>
    <Section title="Pointage mensuel">
      <SimpleTable headers={['Employe', 'Periode', 'Presence', 'Absences', 'Retenue', 'Net estime', 'Statut']} rows={report.attendance.map((row) => [row.employee_name, `${monthLabel(row.month)} ${row.year}`, `${row.present_days}/${row.working_days}`, row.unjustified_absence_days, `${money(row.absence_deduction ?? 0)} USD`, `${money(row.estimated_net_salary ?? 0)} USD`, attendanceStatusLabel(row.status)])} />
    </Section>
    <Section title="Retards et absences">
      <SimpleTable headers={['Employe', 'Service', 'Retards', 'Maladie', 'Conges payes', 'Absences']} rows={report.attendance.map((row) => [row.employee_name, row.department ?? '—', row.late_count ?? 0, row.sick_days, row.paid_leave_days, row.unjustified_absence_days])} />
    </Section>
    <Section title="Paie du mois">
      <SimpleTable headers={['Employe', 'Periode', 'Brut', 'Retenues', 'Avances', 'Net', 'Statut']} rows={report.payrolls.map((row) => [row.employee_name, `${monthLabel(row.month)} ${row.year}`, `${money(row.gross_salary)} USD`, `${money(row.deductions_total)} USD`, `${money(row.advances_total)} USD`, `${money(row.net_salary)} USD`, payrollStatusLabel(row.status)])} />
    </Section>
    <Section title="Repartition par service">
      <SimpleTable headers={['Service', 'Employes']} rows={report.by_department.map((row) => [row.department, row.count])} />
    </Section>
  </section>;
}

function AttendanceModal({ employees, onClose, onSubmit, defaultMonth, defaultYear }: { employees: Employee[]; onClose: () => void; onSubmit: (form: FormData) => void; defaultMonth: string; defaultYear: string }) {
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  return <Modal title="Saisir pointage mensuel" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); if (selectedEmployee) { const form = new FormData(event.currentTarget); form.set('employee_id', String(selectedEmployee)); onSubmit(form); } }}>
      <div className="modal-section"><h3>Pointage mensuel</h3><div className="maintenance-grid hr-form-grid">
        <label>Mois<select name="month" defaultValue={defaultMonth}>{monthOptions()}</select></label>
        <label>Annee<input name="year" defaultValue={defaultYear} /></label>
        <label>Employe *<SearchableSelect options={employeeOptions(employees)} value={selectedEmployee} onChange={(value) => setSelectedEmployee(value ? Number(value) : null)} placeholder="Choisir employe" emptyMessage="Aucun employe" /></label>
        <label>Jours ouvrables *<input type="number" min="1" name="working_days" defaultValue="26" required /></label>
        <label>Jours presents *<input type="number" min="0" name="present_days" defaultValue="26" required /></label>
        <label>Conges payes<input type="number" min="0" name="paid_leave_days" defaultValue="0" /></label>
        <label>Jours maladie<input type="number" min="0" name="sick_days" defaultValue="0" /></label>
        <label>Absences non justifiees<input type="number" min="0" name="unjustified_absence_days" defaultValue="0" /></label>
        <label>Nombre de retards<input type="number" min="0" name="late_count" defaultValue="0" /></label>
        <label>Heures supplementaires<input type="number" min="0" step="0.25" name="overtime_hours" defaultValue="0" /></label>
        <label className="wide-field">Observations<textarea name="observations" rows={3} /></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={!selectedEmployee}>Enregistrer</button></div>
    </form>
  </Modal>;
}

function PayrollModal({ employees, onClose, onSubmit, defaultMonth, defaultYear }: { employees: Employee[]; onClose: () => void; onSubmit: (form: FormData) => void; defaultMonth: string; defaultYear: string }) {
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  return <Modal title="Generer paie du mois" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (selectedEmployee !== 'all') form.set('employee_id', selectedEmployee); onSubmit(form); }}>
      <div className="modal-section"><h3>Generation paie</h3><div className="maintenance-grid hr-form-grid">
        <label>Mois<select name="month" defaultValue={defaultMonth}>{monthOptions()}</select></label>
        <label>Annee<input name="year" defaultValue={defaultYear} /></label>
        <label>Employe<select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)}><option value="all">Tous les employes valides</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}</select></label>
        <label>Statut<select name="status" defaultValue="DRAFT"><option value="DRAFT">Brouillon</option><option value="VALIDATED">Validee</option></select></label>
      </div></div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Generer</button></div>
    </form>
  </Modal>;
}

function PayrollDetailModal({ payroll, onClose, onPay }: { payroll: Payroll; onClose: () => void; onPay: () => void }) {
  return <Modal title={`Fiche de paie - ${payroll.employee_name}`} onClose={onClose}>
    <div className="detail-section report-section">
      <div className="actions-row">
        <button className="secondary" onClick={() => window.print()}><Printer size={15} />Imprimer</button>
        <button className="secondary" onClick={() => exportXlsxWorkbook(`Paie_${payroll.employee_number ?? payroll.id}_${payroll.month}_${payroll.year}.xlsx`, payrollWorkbook([payroll]))}><FileSpreadsheet size={15} />Excel</button>
        {payroll.status !== 'PAID' && <button onClick={onPay}><WalletCards size={15} />Marquer payee</button>}
      </div>
      <div className="summary-band">
        <div className="summary-item"><span>Employe</span><strong>{payroll.employee_name}</strong></div>
        <div className="summary-item"><span>Matricule</span><strong>{payroll.employee_number ?? `EMP-${payroll.employee_id}`}</strong></div>
        <div className="summary-item"><span>Service</span><strong>{payroll.department ?? '—'}</strong></div>
        <div className="summary-item"><span>Fonction</span><strong>{payroll.job_title ?? '—'}</strong></div>
        <div className="summary-item"><span>Periode</span><strong>{monthLabel(payroll.month)} {payroll.year}</strong></div>
        <div className="summary-item"><span>Statut</span><strong>{payrollStatusLabel(payroll.status)}</strong></div>
      </div>
      <SimpleTable headers={['Salaire mensuel', 'Salaire journalier', 'Jours ouvrables', 'Jours presents', 'Conges payes', 'Maladie', 'Absences non justifiees', 'Retenue absences', 'Avances', 'Primes', 'Net a payer']} rows={[[
        `${money(payroll.gross_salary)} USD`,
        `${money(payroll.daily_salary ?? 0)} USD`,
        payroll.working_days ?? 0,
        payroll.present_days ?? 0,
        payroll.paid_leave_days ?? 0,
        payroll.sick_days ?? 0,
        payroll.unjustified_absence_days ?? 0,
        `${money(payroll.absence_deduction ?? payroll.deductions_total ?? 0)} USD`,
        `${money(payroll.advances_total ?? 0)} USD`,
        `${money(payroll.bonus_amount ?? 0)} USD`,
        `${money(payroll.net_salary)} USD`,
      ]]} />
    </div>
  </Modal>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="detail-section report-section"><h4>{title}</h4>{children}</div>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
  return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}><EmptyState message="Aucune donnee." /></td></tr>}</tbody></table></div>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function IconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" className="icon-btn" title={title} onClick={onClick}>{icon}</button>;
}

function employeeName(employee: Pick<Employee, 'first_name' | 'last_name' | 'post_name'>) {
  return [employee.first_name, employee.post_name, employee.last_name].filter(Boolean).join(' ');
}

function employeeOptions(rows: Employee[]): SearchableSelectOption<number>[] {
  return rows.map((row) => ({
    value: row.id,
    label: `${row.employee_number ?? `EMP-${row.id}`} - ${employeeName(row)}`,
    meta: [row.department, row.job_title].filter(Boolean).join(' - '),
  }));
}

function monthOptions() {
  return Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthLabel(index + 1)}</option>);
}

function monthLabel(month: number) {
  return ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][month - 1] ?? String(month);
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
}

function attendanceStatusLabel(value?: string) {
  return ({ DRAFT: 'Brouillon', VALIDATED: 'Valide' } as Record<string, string>)[value ?? ''] ?? value ?? 'Brouillon';
}

function payrollStatusLabel(value?: string) {
  return ({ DRAFT: 'Brouillon', VALIDATED: 'Validee', PAID: 'Payee' } as Record<string, string>)[value ?? ''] ?? value ?? 'Brouillon';
}

function stringValue(form: FormData, key: string) {
  return String(form.get(key) ?? '').trim();
}

function attendancePayload(form: FormData) {
  return {
    employee_id: Number(form.get('employee_id') ?? 0),
    month: Number(form.get('month') ?? new Date().getMonth() + 1),
    year: Number(form.get('year') ?? new Date().getFullYear()),
    working_days: Number(form.get('working_days') ?? 0),
    present_days: Number(form.get('present_days') ?? 0),
    paid_leave_days: Number(form.get('paid_leave_days') ?? 0),
    sick_days: Number(form.get('sick_days') ?? 0),
    unjustified_absence_days: Number(form.get('unjustified_absence_days') ?? 0),
    late_count: Number(form.get('late_count') ?? 0),
    overtime_hours: Number(form.get('overtime_hours') ?? 0),
    observations: stringValue(form, 'observations'),
    status: 'DRAFT',
  };
}

function payrollPayload(form: FormData) {
  return {
    employee_id: form.get('employee_id') ? Number(form.get('employee_id')) : undefined,
    month: Number(form.get('month') ?? new Date().getMonth() + 1),
    year: Number(form.get('year') ?? new Date().getFullYear()),
    status: stringValue(form, 'status') || 'DRAFT',
  };
}

function exportAttendanceRow(row: AttendanceRow) {
  return {
    periode: `${monthLabel(row.month)} ${row.year}`,
    employe: row.employee_name,
    matricule: row.employee_number ?? `EMP-${row.employee_id}`,
    service: row.department ?? '',
    fonction: row.job_title ?? '',
    salaire_mensuel: money(row.monthly_salary ?? 0),
    jours_ouvrables: row.working_days,
    jours_presents: row.present_days,
    conges_payes: row.paid_leave_days,
    maladie: row.sick_days,
    absences_non_justifiees: row.unjustified_absence_days,
    retards: row.late_count ?? 0,
    heures_supplementaires: Number(row.overtime_hours ?? 0).toFixed(2),
    retenue_absences: money(row.absence_deduction ?? 0),
    net_estime: money(row.estimated_net_salary ?? 0),
    statut: attendanceStatusLabel(row.status),
    observations: row.observations ?? '',
  };
}

function exportPayrollRow(row: Payroll) {
  return {
    periode: `${monthLabel(row.month)} ${row.year}`,
    matricule: row.employee_number ?? `EMP-${row.employee_id}`,
    employe: row.employee_name,
    service: row.department ?? '',
    fonction: row.job_title ?? '',
    salaire_mensuel: money(row.gross_salary),
    retenues: money(row.deductions_total),
    avances: money(row.advances_total),
    primes: money(row.bonus_amount ?? 0),
    net_a_payer: money(row.net_salary),
    statut: payrollStatusLabel(row.status),
  };
}

function payrollWorkbook(rows: Payroll[]) {
  return [
    { name: 'Resume', rows: [{ employees: rows.length, masse_brute: money(rows.reduce((sum, row) => sum + Number(row.gross_salary), 0)), total_retenues: money(rows.reduce((sum, row) => sum + Number(row.deductions_total), 0)), total_avances: money(rows.reduce((sum, row) => sum + Number(row.advances_total), 0)), net_total: money(rows.reduce((sum, row) => sum + Number(row.net_salary), 0)) }] },
    { name: 'Listing paie', rows: rows.map(exportPayrollRow) },
    { name: 'Brouillons', rows: rows.filter((row) => row.status === 'DRAFT').map(exportPayrollRow) },
    { name: 'Validees', rows: rows.filter((row) => row.status === 'VALIDATED').map(exportPayrollRow) },
    { name: 'Payees', rows: rows.filter((row) => row.status === 'PAID').map(exportPayrollRow) },
    { name: 'Retenues', rows: rows.map((row) => ({ employe: row.employee_name, retenue_absences: money(row.absence_deduction ?? row.deductions_total ?? 0), avances: money(row.advances_total ?? 0) })) },
    { name: 'Avances', rows: rows.map((row) => ({ employe: row.employee_name, avances: money(row.advances_total ?? 0) })) },
  ];
}

function hrReportWorkbook(report: HrReport) {
  return [
    { name: 'Resume', rows: [report.summary] },
    { name: 'Pointage', rows: report.attendance.map(exportAttendanceRow) },
    { name: 'Paie', rows: report.payrolls.map(exportPayrollRow) },
    { name: 'Services', rows: report.by_department },
    { name: 'Avances', rows: report.advances },
    { name: 'Conges', rows: report.leaves },
  ];
}
