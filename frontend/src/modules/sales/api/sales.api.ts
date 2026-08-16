import { api } from '../../../core/api/axios';
import type {
  CreateSalesBuyerInput,
  CreateSalesCatalogInput,
  CreateSalesProjectInput,
  SalesBootstrap,
  SalesBuyer,
  SalesCatalogItem,
  SalesListQuery,
  SalesListResult,
  SalesProject,
  SalesSettings,
} from '../types';

export async function getSalesBootstrap() {
  const response = await api.get<SalesBootstrap>('/sales/bootstrap');
  return response.data;
}

export async function getSalesSettings() {
  const response = await api.get<SalesSettings>('/sales/settings');
  return response.data;
}

export async function updateSalesSettings(payload: Partial<SalesSettings>) {
  const response = await api.patch<SalesSettings>('/sales/settings', payload);
  return response.data;
}

export async function listSalesBuyers(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesBuyer>>('/sales/buyers', { params });
  return response.data;
}

export async function getSalesBuyer(id: number) {
  const response = await api.get<SalesBuyer>(`/sales/buyers/${id}`);
  return response.data;
}

export async function createSalesBuyer(payload: CreateSalesBuyerInput) {
  const response = await api.post<SalesBuyer>('/sales/buyers', payload);
  return response.data;
}

export async function updateSalesBuyer(id: number, payload: Partial<CreateSalesBuyerInput>) {
  const response = await api.patch<SalesBuyer>(`/sales/buyers/${id}`, payload);
  return response.data;
}

export async function archiveSalesBuyer(id: number) {
  const response = await api.patch<SalesBuyer>(`/sales/buyers/${id}/archive`);
  return response.data;
}

export async function listSalesProjects(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesProject>>('/sales/projects', { params });
  return response.data;
}

export async function getSalesProject(id: number) {
  const response = await api.get<SalesProject>(`/sales/projects/${id}`);
  return response.data;
}

export async function createSalesProject(payload: CreateSalesProjectInput) {
  const response = await api.post<SalesProject>('/sales/projects', payload);
  return response.data;
}

export async function updateSalesProject(id: number, payload: Partial<CreateSalesProjectInput>) {
  const response = await api.patch<SalesProject>(`/sales/projects/${id}`, payload);
  return response.data;
}

export async function archiveSalesProject(id: number) {
  const response = await api.patch<SalesProject>(`/sales/projects/${id}/archive`);
  return response.data;
}

export async function listSalesCatalog(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesCatalogItem>>('/sales/catalog', { params });
  return response.data;
}

export async function getSalesCatalogItem(id: number) {
  const response = await api.get<SalesCatalogItem>(`/sales/catalog/${id}`);
  return response.data;
}

export async function createSalesCatalogItem(payload: CreateSalesCatalogInput) {
  const response = await api.post<SalesCatalogItem>('/sales/catalog', payload);
  return response.data;
}

export async function updateSalesCatalogItem(id: number, payload: Partial<CreateSalesCatalogInput>) {
  const response = await api.patch<SalesCatalogItem>(`/sales/catalog/${id}`, payload);
  return response.data;
}

export async function updateSalesCatalogStatus(id: number, commercial_status: string) {
  const response = await api.patch<SalesCatalogItem>(`/sales/catalog/${id}/status`, { commercial_status });
  return response.data;
}

export async function archiveSalesCatalogItem(id: number) {
  const response = await api.patch<SalesCatalogItem>(`/sales/catalog/${id}/archive`);
  return response.data;
}
