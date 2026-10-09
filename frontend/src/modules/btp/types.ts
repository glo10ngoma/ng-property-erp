export const BTP_MODULE_CODE = "BTP";
export type BtpProject = {
  id: number;
  project_ref: string;
  name: string;
  client_name?: string | null;
  location_label?: string | null;
  description?: string | null;
  status: string;
  start_date?: string | null;
  planned_end_date?: string | null;
  actual_end_date?: string | null;
  manager_name?: string | null;
  planned_budget: number;
  currency: string;
  progress_percent: number;
  spent?: number;
  phase_count?: number;
  phases?: BtpPhase[];
  expenses?: BtpExpense[];
};
export type BtpPhase = {
  id: number;
  project_id: number;
  phase_ref: string;
  name: string;
  description?: string | null;
  status: string;
  start_date?: string | null;
  planned_end_date?: string | null;
  planned_budget: number;
  progress_percent: number;
  sort_order: number;
};
export type BtpExpense = {
  id: number;
  project_id: number;
  phase_id?: number | null;
  expense_date: string;
  reference?: string | null;
  category: string;
  description: string;
  supplier_name?: string | null;
  amount: number;
  currency: string;
  status: string;
  payment_method?: string | null;
  project_name?: string;
  phase_name?: string | null;
};
export type BtpDashboard = {
  total: number;
  active: number;
  paused: number;
  completed: number;
  budget_usd: number;
  progress: number;
  spent_usd: number;
  spent_cdf: number;
  pending: number;
  recent_projects: BtpProject[];
};
export type BtpList<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};
export type BtpProjectInput = Omit<
  BtpProject,
  "id" | "spent" | "phase_count" | "phases" | "expenses"
>;
export type BtpPhaseInput = Omit<BtpPhase, "id">;
export type BtpExpenseInput = Omit<
  BtpExpense,
  "id" | "project_name" | "phase_name"
>;
