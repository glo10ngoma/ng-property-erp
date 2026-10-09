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
