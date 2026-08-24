import { api } from '../../../core/api/axios';
import type {
  CreateSalesBuyerInput,
  CreateSalesCatalogInput,
  CreateSalesProjectInput,
  CreateSalesReservationPaymentInput,
  CreateSalesReservationInput,
  CreateSalesReservationRefundInput,
  CreateSalesSubscriptionInput,
  CancelSalesReservationPaymentInput,
  SalesDocumentGeneration,
  SalesDocumentTemplate,
  SalesDocumentTemplatePayload,
  SalesBootstrap,
  SalesBuyer,
  SalesInvoice,
  SalesInvoicePayment,
  SalesCatalogItem,
  SalesListQuery,
  SalesListResult,
  SalesProject,
  SalesReservation,
  SalesReservationPayment,
  SalesSettings,
  SalesStatusActionInput,
  SalesSubscription,
  SalesSubscriptionFinancialSummary,
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

export async function createSalesDocumentTemplate(payload: SalesDocumentTemplatePayload) {
  const response = await api.post<SalesDocumentTemplate>('/sales/settings/templates', payload);
  return response.data;
}

export async function updateSalesDocumentTemplate(id: number, payload: SalesDocumentTemplatePayload) {
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

export async function listSalesReservationPayments(id: number) {
  const response = await api.get<SalesReservationPayment[]>(`/sales/reservations/${id}/payments`);
  return response.data;
}

export async function createSalesReservationPayment(id: number, payload: CreateSalesReservationPaymentInput) {
  const response = await api.post<SalesReservationPayment>(`/sales/reservations/${id}/payments`, payload);
  return response.data;
}

export async function getSalesReservationPayment(id: number) {
  const response = await api.get<SalesReservationPayment>(`/sales/reservation-payments/${id}`);
  return response.data;
}

export async function cancelSalesReservationPayment(id: number, payload: CancelSalesReservationPaymentInput) {
  const response = await api.post<SalesReservationPayment>(`/sales/reservation-payments/${id}/cancel`, payload);
  return response.data;
}

export async function createSalesReservationRefund(id: number, payload: CreateSalesReservationRefundInput) {
  const response = await api.post<SalesReservationPayment>(`/sales/reservation-payments/${id}/refunds`, payload);
  return response.data;
}

export async function regenerateSalesReservationPaymentReceipt(id: number) {
  const response = await api.post<SalesDocumentGeneration>(`/sales/reservation-payments/${id}/receipt/regenerate`);
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

export async function getSalesSubscriptionFinancialSummary(id: number) {
  const response = await api.get<SalesSubscriptionFinancialSummary>(`/sales/subscriptions/${id}/financial-summary`);
  return response.data;
}

export async function listSalesSubscriptionInstallments(id: number) {
  const response = await api.get<SalesSubscriptionFinancialSummary['installments']>(`/sales/subscriptions/${id}/installments`);
  return response.data;
}

export async function listSalesInvoices(params: SalesListQuery = {}) {
  const response = await api.get<SalesListResult<SalesInvoice>>('/sales/invoices', { params });
  return response.data;
}

export async function getSalesInvoice(id: number) {
  const response = await api.get<SalesInvoice>(`/sales/invoices/${id}`);
  return response.data;
}

export async function generateSalesInvoice(subscriptionId: number, installmentId: number) {
  const response = await api.post<SalesInvoice>(`/sales/subscriptions/${subscriptionId}/installments/${installmentId}/invoice`);
  return response.data;
}

export async function issueSalesInvoice(id: number) {
  const response = await api.post<SalesInvoice>(`/sales/invoices/${id}/issue`);
  return response.data;
}

export async function cancelSalesInvoice(id: number, payload: SalesStatusActionInput = {}) {
  const response = await api.post<SalesInvoice>(`/sales/invoices/${id}/cancel`, payload);
  return response.data;
}

export async function listSalesInvoicePayments(id: number) {
  const response = await api.get<SalesInvoicePayment[]>(`/sales/invoices/${id}/payments`);
  return response.data;
}

export async function createSalesInvoicePayment(id: number, payload: CreateSalesReservationPaymentInput) {
  const response = await api.post<SalesInvoice>(`/sales/invoices/${id}/payments`, payload);
  return response.data;
}

export async function cancelSalesInvoicePayment(id: number, payload: CancelSalesReservationPaymentInput) {
  const response = await api.post<SalesInvoice>(`/sales/invoice-payments/${id}/cancel`, payload);
  return response.data;
}

export async function refundSalesInvoicePayment(id: number, payload: CreateSalesReservationRefundInput) {
  const response = await api.post<SalesInvoice>(`/sales/invoice-payments/${id}/refunds`, payload);
  return response.data;
}

export async function regenerateSalesInvoicePaymentReceipt(id: number) {
  const response = await api.post<SalesInvoice>(`/sales/invoice-payments/${id}/receipt/regenerate`);
  return response.data;
}

export async function regenerateSalesInvoiceDocument(id: number) {
  const response = await api.post<SalesInvoice>(`/sales/invoices/${id}/documents/regenerate`);
  return response.data;
}

export async function sendSalesInvoice(id: number) {
  const response = await api.post<SalesInvoice>(`/sales/invoices/${id}/send`);
  return response.data;
}

export async function downloadSalesDocument(id: number) {
  const response = await api.get<Blob>(`/sales/documents/${id}/download`, {
    responseType: 'blob',
  });
  return response.data;
}
