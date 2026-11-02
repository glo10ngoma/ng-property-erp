import { api } from "../../../core/api/axios";
import type {
  BtpDashboard,
  BtpExpense,
  BtpExpenseInput,
  BtpList,
  BtpPhase,
  BtpPhaseInput,
  BtpProject,
  BtpProjectInput,
  BtpOperationalRecord,
  BtpReportRow,
} from "../types";
export const getBtpDashboard = async () =>
  (await api.get<BtpDashboard>("/btp/dashboard")).data;
export const listBtpProjects = async (params: Record<string, unknown> = {}) =>
  (await api.get<BtpList<BtpProject>>("/btp/projects", { params })).data;
export const getBtpProject = async (id: number) =>
  (await api.get<BtpProject>(`/btp/projects/${id}`)).data;
export const createBtpProject = async (payload: Partial<BtpProjectInput>) =>
  (await api.post<BtpProject>("/btp/projects", payload)).data;
export const updateBtpProject = async (
  id: number,
  payload: Partial<BtpProjectInput>,
) => (await api.patch<BtpProject>(`/btp/projects/${id}`, payload)).data;
export const createBtpPhase = async (payload: Partial<BtpPhaseInput>) =>
  (await api.post<BtpPhase>("/btp/phases", payload)).data;
export const updateBtpPhase = async (
  id: number,
  payload: Partial<BtpPhaseInput>,
) => (await api.patch<BtpPhase>(`/btp/phases/${id}`, payload)).data;
export const listBtpExpenses = async (params: Record<string, unknown> = {}) =>
  (await api.get<BtpList<BtpExpense>>("/btp/expenses", { params })).data;
export const createBtpExpense = async (payload: Partial<BtpExpenseInput>) =>
  (await api.post<BtpExpense>("/btp/expenses", payload)).data;
export const updateBtpExpense = async (
  id: number,
  payload: Partial<BtpExpenseInput>,
) => (await api.patch<BtpExpense>(`/btp/expenses/${id}`, payload)).data;

type BtpWorkspaceEndpoint =
  | "budgets"
  | "purchases"
  | "stock-movements"
  | "site-logs"
  | "client-contracts"
  | "client-transactions";
export const listBtpWorkspace = async (
  endpoint: BtpWorkspaceEndpoint,
  params: Record<string, unknown> = {},
) =>
  (await api.get<BtpList<BtpOperationalRecord>>(`/btp/${endpoint}`, { params }))
    .data;
export const createBtpWorkspace = async (
  endpoint: BtpWorkspaceEndpoint,
  payload: Record<string, unknown>,
) => (await api.post<BtpOperationalRecord>(`/btp/${endpoint}`, payload)).data;
export const getBtpReports = async (params: Record<string, unknown> = {}) =>
  (await api.get<BtpList<BtpReportRow>>("/btp/reports", { params })).data;

export const listBtpDqe = async (id:number) => (await api.get<{items:any[]}>(`/btp/projects/${id}/dqe`)).data;
export const createBtpDqe = async (payload:Record<string,unknown>) => (await api.post("/btp/dqe",payload)).data;
export const listBtpSchedule = async (id:number) => (await api.get<{items:any[]}>(`/btp/projects/${id}/schedule`)).data;
export const createBtpSchedule = async (payload:Record<string,unknown>) => (await api.post("/btp/schedule",payload)).data;
