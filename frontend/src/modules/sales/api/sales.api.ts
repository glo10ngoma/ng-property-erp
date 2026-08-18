import { api } from '../../../core/api/axios';
import type {
  CreateSalesBuyerInput,
  CreateSalesCatalogInput,
  CreateSalesProjectInput,
  CreateSalesReservationInput,
  CreateSalesSubscriptionInput,
  SalesDocumentGeneration,
  SalesDocumentTemplate,
  SalesBootstrap,
  SalesBuyer,
  SalesCatalogItem,
  SalesListQuery,
  SalesListResult,
  SalesProject,
  SalesReservation,
  SalesSettings,
  SalesStatusActionInput,
  SalesSubscription,
  SalesSubscriptionSimulation,
  SimulateSalesSubscriptionInput,
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

export async function listSalesDocumentTemplates() {
  const response = await api.get<SalesDocumentTemplate[]>('/sales/settings/templates');
  return response.data;
}

export async function createSalesDocumentTemplate(payload: Partial<SalesDocumentTemplate>) {
  const response = await api.post<SalesDocumentTemplate>('/sales/settings/templates', payload);
  return response.data;
}

export async function updateSalesDocumentTemplate(id: number, payload: Partial<SalesDocumentTemplate>) {
  const response = await api.patch<SalesDocumentTemplate>(`/sales/settings/templates/${id}`, payload);
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

export async function listSalesReservations(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesReservation>>('/sales/reservations', { params });
  return response.data;
}

export async function getSalesReservation(id: number) {
  const response = await api.get<SalesReservation>(`/sales/reservations/${id}`);
  return response.data;
}

export async function createSalesReservation(payload: CreateSalesReservationInput) {
  const response = await api.post<SalesReservation>('/sales/reservations', payload);
  return response.data;
}

export async function updateSalesReservation(id: number, payload: Partial<CreateSalesReservationInput>) {
  const response = await api.patch<SalesReservation>(`/sales/reservations/${id}`, payload);
  return response.data;
}

export async function confirmSalesReservation(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesReservation>(`/sales/reservations/${id}/confirm`, payload);
  return response.data;
}

export async function cancelSalesReservation(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesReservation>(`/sales/reservations/${id}/cancel`, payload);
  return response.data;
}

export async function expireSalesReservation(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesReservation>(`/sales/reservations/${id}/expire`, payload);
  return response.data;
}

export async function convertSalesReservation(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesReservation>(`/sales/reservations/${id}/convert`, payload);
  return response.data;
}

export async function listSalesReservationDocuments(id: number) {
  const response = await api.get<SalesDocumentGeneration[]>(`/sales/reservations/${id}/documents`);
  return response.data;
}

export async function regenerateSalesReservationDocument(id: number) {
  const response = await api.post<SalesDocumentGeneration>(`/sales/reservations/${id}/documents/regenerate`);
  return response.data;
}

export async function listSalesSubscriptions(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesSubscription>>('/sales/subscriptions', { params });
  return response.data;
}

export async function getSalesSubscription(id: number) {
  const response = await api.get<SalesSubscription>(`/sales/subscriptions/${id}`);
  return response.data;
}

export async function simulateSalesSubscription(payload: SimulateSalesSubscriptionInput) {
  const response = await api.post<SalesSubscriptionSimulation>('/sales/subscriptions/simulate', payload);
  return response.data;
}

export async function createSalesSubscription(payload: CreateSalesSubscriptionInput) {
  const response = await api.post<SalesSubscription>('/sales/subscriptions', payload);
  return response.data;
}

export async function updateSalesSubscription(id: number, payload: Partial<CreateSalesSubscriptionInput>) {
  const response = await api.patch<SalesSubscription>(`/sales/subscriptions/${id}`, payload);
  return response.data;
}

export async function submitSalesSubscription(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesSubscription>(`/sales/subscriptions/${id}/submit`, payload);
  return response.data;
}

export async function approveSalesSubscription(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesSubscription>(`/sales/subscriptions/${id}/approve`, payload);
  return response.data;
}

export async function rejectSalesSubscription(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesSubscription>(`/sales/subscriptions/${id}/reject`, payload);
  return response.data;
}

export async function cancelSalesSubscription(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesSubscription>(`/sales/subscriptions/${id}/cancel`, payload);
  return response.data;
}

export async function listSalesSubscriptionDocuments(id: number) {
  const response = await api.get<SalesDocumentGeneration[]>(`/sales/subscriptions/${id}/documents`);
  return response.data;
}

export async function regenerateSalesSubscriptionDocument(id: number) {
  const response = await api.post<SalesDocumentGeneration>(`/sales/subscriptions/${id}/documents/regenerate`);
  return response.data;
}

export async function downloadSalesDocument(id: number) {
  const response = await api.get<Blob>(`/sales/documents/${id}/download`, {
    responseType: 'blob',
  });
  return response.data;
}
