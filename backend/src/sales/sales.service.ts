import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  CreateSalesReservationPaymentDto,
  CreateSalesReservationDto,
  CreateSalesReservationRefundDto,
  CreateSalesSubscriptionDto,
  CancelSalesReservationPaymentDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesDocumentTemplateDto,
  SalesProjectListQueryDto,
  SalesReservationListQueryDto,
  SalesSubscriptionListQueryDto,
  SimulateSalesSubscriptionDto,
  UpdateSalesDocumentTemplateDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesCatalogStatusDto,
  UpdateSalesProjectDto,
  UpdateSalesReservationDto,
  UpdateSalesSettingsDto,
  UpdateSalesSubscriptionDto,
} from './dto';
import { SalesDocumentsService } from './sales-documents.service';
import { SalesRepository } from './sales.repository';
import { simulateSalesSubscriptionPlan } from './subscription-schedule';
import { SALES_MODULE_CODE } from './types';

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly repository: SalesRepository,
    private readonly documents: SalesDocumentsService,
  ) {}

  async bootstrap() {
    return {
      module: SALES_MODULE_CODE,
      organization_id: this.context.organizationId(),
      permissions: this.context.user()?.permissions ?? [],
      settings: await this.repository.findSettings(this.context.organizationId()),
    };
  }

  getSettings() {
    return this.repository.findSettings(this.context.organizationId());
  }

  updateSettings(dto: UpdateSalesSettingsDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findSettings(organizationId, client);
      const after = await this.repository.upsertSettings(organizationId, dto, client);
      await this.repository.writeAuditEvent(
        organizationId,
        'sales_settings',
        Number(after.id),
        'SALES_SETTINGS_UPDATED',
        this.context.userId(),
        before,
        after,
        client,
      );
      return after;
    });
  }

  listBuyers(query: SalesBuyerListQueryDto) {
    return this.repository.listBuyers(this.context.organizationId(), query);
  }

  async getBuyer(id: number) {
    const row = await this.repository.findBuyer(this.context.organizationId(), id);
    if (!row) throw new NotFoundException('Buyer not found');
    return row;
  }

  createBuyer(dto: CreateSalesBuyerDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const buyerRef = dto.buyer_ref?.trim() || await this.generateReference(
        organizationId,
        'BUYER',
        settings?.buyer_number_format || 'ACQ-{YYYY}-{SEQ:5}',
        client,
      );
      const created = await this.repository.createBuyer(organizationId, this.context.userId(), { ...dto, buyer_ref: buyerRef }, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_buyer', Number(created.id), 'SALES_BUYER_CREATED', this.context.userId(), null, created, client);
      return created;
    });
  }

  updateBuyer(id: number, dto: UpdateSalesBuyerDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findBuyer(organizationId, id, client);
      if (!before) throw new NotFoundException('Buyer not found');
      const after = await this.repository.updateBuyer(organizationId, id, this.context.userId(), dto, client);
      if (!after) throw new NotFoundException('Buyer not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_buyer', id, 'SALES_BUYER_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
  }

  archiveBuyer(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findBuyer(organizationId, id, client);
      if (!before) throw new NotFoundException('Buyer not found');
      const after = await this.repository.archiveBuyer(organizationId, id, this.context.userId(), client);
      if (!after) throw new NotFoundException('Buyer not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_buyer', id, 'SALES_BUYER_ARCHIVED', this.context.userId(), before, after, client);
      return after;
    });
  }

  listProjects(query: SalesProjectListQueryDto) {
    return this.repository.listProjects(this.context.organizationId(), query);
  }

  async getProject(id: number) {
    const row = await this.repository.findProject(this.context.organizationId(), id);
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  createProject(dto: CreateSalesProjectDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const projectRef = dto.project_ref?.trim() || await this.generateReference(
        organizationId,
        'PROJECT',
        settings?.project_number_format || 'PRJ-{YYYY}-{SEQ:4}',
        client,
      );
      const created = await this.repository.createProject(organizationId, this.context.userId(), { ...dto, project_ref: projectRef }, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_project', Number(created.id), 'SALES_PROJECT_CREATED', this.context.userId(), null, created, client);
      return created;
    });
  }

  updateProject(id: number, dto: UpdateSalesProjectDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findProject(organizationId, id, client);
      if (!before) throw new NotFoundException('Project not found');
      const after = await this.repository.updateProject(organizationId, id, this.context.userId(), dto, client);
      if (!after) throw new NotFoundException('Project not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_project', id, 'SALES_PROJECT_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
  }

  archiveProject(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findProject(organizationId, id, client);
      if (!before) throw new NotFoundException('Project not found');
      const after = await this.repository.archiveProject(organizationId, id, this.context.userId(), client);
      if (!after) throw new NotFoundException('Project not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_project', id, 'SALES_PROJECT_ARCHIVED', this.context.userId(), before, after, client);
      return after;
    });
  }

  listCatalog(query: SalesCatalogListQueryDto) {
    return this.repository.listCatalog(this.context.organizationId(), query);
  }

  async getCatalogItem(id: number) {
    const row = await this.repository.findCatalogItem(this.context.organizationId(), id);
    if (!row) throw new NotFoundException('Catalog item not found');
    return row;
  }

  createCatalogItem(dto: CreateSalesCatalogItemDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      this.repository.validateCatalogMoney(dto);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id, client);
      await this.repository.ensureBuildingBelongsToOrganization(organizationId, dto.building_id, client);
      await this.repository.ensureUnitBelongsToOrganization(organizationId, dto.unit_id, client);
      const catalogRef = dto.catalog_ref?.trim() || await this.generateReference(
        organizationId,
        'CATALOG',
        settings?.catalog_number_format || 'BIE-{YYYY}-{SEQ:5}',
        client,
      );
      const created = await this.repository.createCatalogItem(organizationId, this.context.userId(), { ...dto, catalog_ref: catalogRef }, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_catalog', Number(created.id), 'SALES_CATALOG_CREATED', this.context.userId(), null, created, client);
      return created;
    });
  }

  updateCatalogItem(id: number, dto: UpdateSalesCatalogItemDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findCatalogItem(organizationId, id, client);
      if (!before) throw new NotFoundException('Catalog item not found');
      this.repository.validateCatalogMoney({
        list_price: dto.list_price ?? before.list_price,
        minimum_price: dto.minimum_price ?? before.minimum_price,
        currency: dto.currency ?? before.currency,
      });
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? before.project_id, client);
      await this.repository.ensureBuildingBelongsToOrganization(organizationId, dto.building_id ?? before.building_id, client);
      await this.repository.ensureUnitBelongsToOrganization(organizationId, dto.unit_id ?? before.unit_id, client);
      const after = await this.repository.updateCatalogItem(organizationId, id, this.context.userId(), dto, client);
      if (!after) throw new NotFoundException('Catalog item not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_catalog', id, 'SALES_CATALOG_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
  }

  updateCatalogStatus(id: number, dto: UpdateSalesCatalogStatusDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findCatalogItem(organizationId, id, client);
      if (!before) throw new NotFoundException('Catalog item not found');
      const after = await this.repository.updateCatalogStatus(organizationId, id, dto.commercial_status, this.context.userId(), client);
      if (!after) throw new NotFoundException('Catalog item not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_catalog', id, 'SALES_CATALOG_STATUS_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
  }

  archiveCatalogItem(id: number) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findCatalogItem(organizationId, id, client);
      if (!before) throw new NotFoundException('Catalog item not found');
      const after = await this.repository.archiveCatalogItem(organizationId, id, this.context.userId(), client);
      if (!after) throw new NotFoundException('Catalog item not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_catalog', id, 'SALES_CATALOG_ARCHIVED', this.context.userId(), before, after, client);
      return after;
    });
  }

  listReservations(query: SalesReservationListQueryDto) {
    return this.repository.listReservations(this.context.organizationId(), query);
  }

  async getReservation(id: number) {
    const row = await this.repository.findReservation(this.context.organizationId(), id);
    if (!row) throw new NotFoundException('Reservation not found');
    const feeSummary = await this.buildReservationFeeSummary(id);
    const payments = await this.listReservationPayments(id);
    const paymentDestinations = await this.getReservationPaymentDestinations(String(row.currency ?? 'USD'));
    const documents = await this.documents.listReservationDocuments(this.context.organizationId(), id);
    return { ...row, ...feeSummary, fee_summary: feeSummary, payments, payment_destinations: paymentDestinations, documents };
  }

  async listReservationPayments(id: number) {
    await this.ensureReservationExists(id);
    const payments = await this.repository.listReservationPayments(this.context.organizationId(), id);
    return Promise.all(payments.map(async (payment) => {
      const refunds = await this.repository.listReservationRefunds(this.context.organizationId(), Number(payment.id));
      const receipt = await this.findLatestGeneratedDocument('RESERVATION_PAYMENT', Number(payment.id));
      const refundsWithReceipts = await Promise.all(refunds.map(async (refund) => ({
        ...refund,
        receipt: await this.findLatestGeneratedDocument('RESERVATION_REFUND', Number(refund.id)),
      })));
      return {
        ...payment,
        receipt,
        refunds: refundsWithReceipts,
      };
    }));
  }

  async getReservationPayment(id: number) {
    const payment = await this.repository.findReservationPayment(this.context.organizationId(), id);
    if (!payment) throw new NotFoundException('Reservation payment not found');
    const refunds = await this.repository.listReservationRefunds(this.context.organizationId(), id);
    return {
      ...payment,
      receipt: await this.findLatestGeneratedDocument('RESERVATION_PAYMENT', id),
      refunds: await Promise.all(refunds.map(async (refund) => ({
        ...refund,
        receipt: await this.findLatestGeneratedDocument('RESERVATION_REFUND', Number(refund.id)),
      }))),
    };
  }

  async createReservation(dto: CreateSalesReservationDto) {
    const created = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const buyer = await this.repository.findBuyerForSale(organizationId, dto.buyer_id, client);
      const catalog = await this.repository.lockCatalogItem(organizationId, dto.catalog_item_id, client);
      const projectId = dto.project_id ?? catalog.project_id ?? null;
      await this.assertCatalogProjectConsistency(catalog, projectId);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, projectId, client);
      const expiresAt = dto.expires_at ?? this.defaultReservationExpiry(dto.reservation_date, settings?.reservation_default_duration_days);
      await this.assertReservationAvailability(organizationId, Number(catalog.id), client);
      await this.validateReservationInput(
        { ...dto, project_id: projectId ?? undefined, expires_at: expiresAt },
        buyer.id,
        catalog,
        settings,
        client,
      );

      const reservationNumber = dto.reservation_number?.trim() || await this.generateReference(
        organizationId,
        'RESERVATION',
        settings?.reservation_number_format || 'RSV-{YYYY}-{SEQ:5}',
        client,
      );
      const created = await this.repository.createReservation(
        organizationId,
        this.context.userId(),
        { ...dto, project_id: projectId ?? undefined, expires_at: expiresAt, status: dto.status ?? 'ACTIVE' },
        reservationNumber,
        client,
      );

      await this.repository.setBuyerCommercialStage(organizationId, dto.buyer_id, 'RESERVING', this.context.userId(), client);
      if ((created.status ?? 'ACTIVE') !== 'DRAFT') {
        await this.repository.updateCatalogStatus(organizationId, dto.catalog_item_id, 'RESERVED', this.context.userId(), client);
      }
      await this.repository.writeStatusHistory(organizationId, 'reservation', Number(created.id), null, created.status, null, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_reservation', Number(created.id), 'SALES_RESERVATION_CREATED', this.context.userId(), null, created, client);
      return created;
    });
    await this.generateReservationDocumentSafely(Number(created.id));
    return this.getReservation(Number(created.id));
  }

  async updateReservation(id: number, dto: UpdateSalesReservationDto) {
    const updated = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findReservation(organizationId, id, client);
      if (!before) throw new NotFoundException('Reservation not found');
      if (!['DRAFT', 'ACTIVE'].includes(before.status)) {
        throw new BadRequestException("Seules les réservations en brouillon ou actives peuvent être modifiées.");
      }

      const settings = await this.repository.findSettings(organizationId, client);
      const buyerId = dto.buyer_id ?? before.buyer_id;
      const catalogItemId = dto.catalog_item_id ?? before.catalog_item_id;
      const reservationDate = dto.reservation_date ?? before.reservation_date;
      const expiresAt = dto.expires_at ?? before.expires_at ?? this.defaultReservationExpiry(reservationDate, settings?.reservation_default_duration_days);
      const catalog = await this.repository.lockCatalogItem(organizationId, catalogItemId, client);
      const projectId = dto.project_id ?? before.project_id ?? catalog.project_id ?? null;
      await this.assertCatalogProjectConsistency(catalog, projectId);
      await this.repository.findBuyerForSale(organizationId, buyerId, client);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, projectId, client);
      await this.assertReservationAvailability(organizationId, catalogItemId, client, id);
      await this.validateReservationInput(
        {
          buyer_id: buyerId,
          catalog_item_id: catalogItemId,
          project_id: projectId ?? undefined,
          currency: dto.currency ?? before.currency,
          catalog_price: dto.catalog_price ?? before.catalog_price,
          negotiated_price: dto.negotiated_price ?? before.negotiated_price,
          reservation_fee: dto.reservation_fee ?? before.reservation_fee ?? 0,
          reservation_date: reservationDate,
          expires_at: expiresAt ?? undefined,
          notes: dto.notes ?? before.notes ?? undefined,
          status: dto.status ?? before.status,
        },
        buyerId,
        catalog,
        settings,
        client,
      );

      const after = await this.repository.updateReservation(
        organizationId,
        id,
        this.context.userId(),
        { ...dto, project_id: projectId ?? undefined, expires_at: expiresAt },
        client,
      );
      if (!after) throw new NotFoundException('Reservation not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_reservation', id, 'SALES_RESERVATION_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
    await this.generateReservationDocumentSafely(id);
    return this.getReservation(Number(updated.id));
  }

  confirmReservation(id: number, reason?: string) {
    return this.changeReservationStatus(id, 'CONFIRMED', reason ?? null);
  }

  cancelReservation(id: number, reason?: string) {
    return this.changeReservationStatus(id, 'CANCELLED', reason ?? null);
  }

  expireReservation(id: number, reason?: string) {
    return this.changeReservationStatus(id, 'EXPIRED', reason ?? null);
  }

  convertReservation(id: number, reason?: string) {
    return this.changeReservationStatus(id, 'CONVERTED', reason ?? null);
  }

  listSubscriptions(query: SalesSubscriptionListQueryDto) {
    return this.repository.listSubscriptions(this.context.organizationId(), query);
  }

  async getSubscription(id: number) {
    const row = await this.repository.findSubscription(this.context.organizationId(), id);
    if (!row) throw new NotFoundException('Subscription not found');
    const installments = await this.repository.listSubscriptionInstallments(this.context.organizationId(), id);
    const documents = await this.documents.listSubscriptionDocuments(this.context.organizationId(), id);
    return { ...row, installments, documents };
  }

  async createReservationPayment(id: number, dto: CreateSalesReservationPaymentDto) {
    let shouldGenerateReceipt = true;
    const payment = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const reservation = await this.repository.lockReservation(organizationId, id, client);
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (['CANCELLED', 'EXPIRED'].includes(String(reservation.status ?? '').toUpperCase())) {
        throw new ConflictException('Impossible d’encaisser des frais sur une réservation annulée ou expirée.');
      }

      const summary = await this.buildReservationFeeSummary(id, client);
      const amount = Number(dto.amount ?? 0);
      const currency = String(reservation.currency ?? 'USD').toUpperCase();
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Le montant du paiement doit être strictement positif.');
      }
      if (amount > Number(summary.fee_remaining ?? 0) + 0.0001) {
        throw new BadRequestException('Le montant dépasse le restant à encaisser.');
      }

      const paymentMethod = String(dto.payment_method ?? '').toUpperCase();
      const destinationType = String(dto.destination_type ?? '').toUpperCase();
      if (destinationType === 'OTHER' && (!String(dto.external_reference ?? '').trim() || !String(dto.notes ?? '').trim())) {
        throw new BadRequestException('Une référence et une observation sont obligatoires pour une destination de type Autre.');
      }

      const idempotencyKey = String(dto.idempotency_key ?? [
        'SALES_RESERVATION_PAYMENT',
        organizationId,
        id,
        String(dto.payment_date ?? ''),
        amount.toFixed(2),
        paymentMethod,
        destinationType,
      ].join(':'));
      const duplicate = await this.repository.findReservationPaymentByIdempotency(organizationId, idempotencyKey, client);
      if (duplicate) {
        shouldGenerateReceipt = false;
        const duplicateMatchesPayload =
          Number(duplicate.reservation_id ?? 0) === Number(id)
          && Number(duplicate.amount ?? 0) === amount
          && String(duplicate.currency ?? '').toUpperCase() === currency
          && String(duplicate.payment_method ?? '').toUpperCase() === paymentMethod
          && String(duplicate.destination_type ?? '').toUpperCase() === destinationType;
        if (!duplicateMatchesPayload) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
            message: 'Cette clé d’idempotence est déjà utilisée pour un autre paiement de frais de réservation.',
          });
        }
        return duplicate;
      }

      const settings = await this.repository.findSettings(organizationId, client);
      const paymentNumber = await this.generateReference(
        organizationId,
        'RESERVATION_PAYMENT',
        settings?.reservation_payment_number_format || 'PRS-{YYYY}-{SEQ:5}',
        client,
      );

      const bankAccount = destinationType === 'BANK' || destinationType === 'MOBILE_MONEY'
        ? await this.requireSalesBankAccount(organizationId, Number(dto.bank_account_id ?? 0), currency, client)
        : null;
      const cashSession = destinationType === 'CASH'
        ? await this.requireOpenCashSession(organizationId, Number(dto.cash_session_id ?? 0), client)
        : null;

      let created = await this.repository.createReservationPayment(
        organizationId,
        this.context.userId(),
        {
          reservation_id: id,
          payment_number: paymentNumber,
          payment_date: dto.payment_date,
          amount,
          currency,
          payment_method: paymentMethod,
          destination_type: destinationType,
          cash_session_id: cashSession?.id ?? null,
          bank_account_id: bankAccount?.id ?? null,
          external_reference: dto.external_reference ?? null,
          idempotency_key: idempotencyKey,
          accounting_treatment_snapshot: String(settings?.reservation_fee_accounting_treatment ?? 'CUSTOMER_ADVANCE').toUpperCase(),
          status: 'CONFIRMED',
          notes: dto.notes ?? null,
        },
        client,
      );

      let cashMovementId: number | null = null;
      let bankTransactionId: number | null = null;
      if (destinationType === 'CASH') {
        cashMovementId = await this.createReservationCashMovement(client, {
          paymentId: Number(created.id),
          reservation,
          sessionId: Number(cashSession?.id),
          type: 'IN',
          category: 'SALES_RESERVATION_FEE',
          amount,
          currency,
          movementDate: dto.payment_date,
          reference: String(dto.external_reference ?? paymentNumber).trim() || paymentNumber,
          description: `Frais de réservation — ${reservation.reservation_number}`,
        });
      } else if (bankAccount) {
        bankTransactionId = await this.createReservationBankTransaction(client, {
          paymentId: Number(created.id),
          reservation,
          bankAccountId: Number(bankAccount.id),
          direction: 'IN',
          amount,
          currency,
          transactionDate: dto.payment_date,
          reference: String(dto.external_reference ?? paymentNumber).trim() || paymentNumber,
          description: `Frais de réservation — ${reservation.reservation_number}`,
          paymentMethod,
        });
      }

      created = await this.repository.updateReservationPaymentLinks(
        organizationId,
        Number(created.id),
        { cash_movement_id: cashMovementId, bank_transaction_id: bankTransactionId },
        client,
      ) ?? created;

      await this.writeSalesAuditLog(client, 'SALES_RESERVATION_PAYMENT_CREATED', 'sales_reservation_payments', String(created.id), `/api/sales/reservations/${id}/payments`, 201, {
        reservation_id: id,
        payment_number: paymentNumber,
        amount,
        currency,
        payment_method: paymentMethod,
        destination_type: destinationType,
        cash_session_id: cashSession?.id ?? null,
        bank_account_id: bankAccount?.id ?? null,
        cash_movement_id: cashMovementId,
        bank_transaction_id: bankTransactionId,
      });

      return created;
    });
    if (shouldGenerateReceipt) {
      await this.documents.regenerateReservationFeeReceiptFromPayment(this.context.organizationId(), Number(payment.id), this.context.userId());
    }
    return this.getReservationPayment(Number(payment.id));
  }

  async cancelReservationPayment(id: number, dto: CancelSalesReservationPaymentDto) {
    await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const payment = await this.repository.findReservationPayment(organizationId, id, client);
      if (!payment) throw new NotFoundException('Reservation payment not found');
      const allocationRows = await this.repository.listActiveReservationFeeAllocations(organizationId, Number(payment.reservation_id), client);
      const allocated = allocationRows
        .filter((row: any) => Number(row.reservation_payment_id ?? 0) === Number(payment.id))
        .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
      const refunds = await this.repository.listReservationRefunds(organizationId, Number(payment.id), client);
      const refundedAmount = refunds
        .filter((row: any) => ['CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(String(row.status ?? '').toUpperCase()))
        .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
      const paymentStatus = String(payment.status ?? '').toUpperCase();
      const cashSession = payment.cash_session_id
        ? await this.repository.findOpenCashSession(organizationId, Number(payment.cash_session_id), client)
        : null;
      const cancellationReasonCode =
        paymentStatus === 'CANCELLED'
          ? 'PAYMENT_ALREADY_CANCELLED'
          : paymentStatus === 'REFUNDED'
            ? 'PAYMENT_ALREADY_REFUNDED'
            : refundedAmount > 0
              ? 'PAYMENT_PARTIALLY_REFUNDED'
              : allocated > 0
                ? 'PAYMENT_ALREADY_ALLOCATED'
                : String(payment.destination_type ?? '').toUpperCase() === 'CASH'
                  && payment.cash_session_id
                  && String(cashSession?.status ?? 'OPEN').toUpperCase() !== 'OPEN'
                    ? 'CASH_SESSION_CLOSED'
                    : null;
      this.devSalesLog('[SALES_PAYMENT_CANCEL_DEV]', {
        paymentId: Number(payment.id),
        status: paymentStatus,
        refundedAmount,
        allocatedAmount: allocated,
        cashSessionStatus: payment.cash_session_id ? String(cashSession?.status ?? 'UNKNOWN').toUpperCase() : null,
        bankTransactionStatus: payment.bank_transaction_id ? 'VALIDATED' : null,
        cancellationReasonCode,
      });
      if (cancellationReasonCode === 'PAYMENT_ALREADY_CANCELLED') {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_CANCELLED',
          message: 'Ce paiement est déjà annulé.',
        });
      }
      if (cancellationReasonCode === 'PAYMENT_ALREADY_REFUNDED') {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_REFUNDED',
          message: 'Ce paiement est déjà totalement remboursé et ne peut plus être annulé.',
        });
      }
      if (cancellationReasonCode === 'PAYMENT_PARTIALLY_REFUNDED') {
        throw new ConflictException({
          code: 'PAYMENT_PARTIALLY_REFUNDED',
          message: 'Ce paiement a déjà fait l’objet d’un remboursement partiel. Utilisez un remboursement ou une écriture de correction.',
        });
      }
      if (allocated > 0) {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_ALLOCATED',
          message: 'Ce paiement est déjà affecté à une souscription. Inversez d’abord l’allocation avant de l’annuler.',
        });
      }
      if (String(payment.destination_type ?? '').toUpperCase() === 'CASH') {
        const session = await this.requireOpenCashSession(organizationId, Number(payment.cash_session_id ?? 0), client);
        await this.createReservationCashMovement(client, {
          paymentId: Number(payment.id),
          reservation: { reservation_number: `ANN-${payment.payment_number}` },
          sessionId: Number(session.id),
          type: 'OUT',
          category: 'SALES_RESERVATION_FEE_REVERSAL',
          amount: Number(payment.amount ?? 0),
          currency: String(payment.currency ?? 'USD'),
          movementDate: new Date().toISOString().slice(0, 10),
          reference: String(payment.external_reference ?? payment.payment_number ?? id),
          description: `Annulation frais de réservation — ${payment.payment_number}`,
        });
      } else if (payment.bank_account_id) {
        await this.createReservationBankTransaction(client, {
          paymentId: Number(payment.id),
          reservation: { reservation_number: `ANN-${payment.payment_number}` },
          bankAccountId: Number(payment.bank_account_id),
          direction: 'OUT',
          amount: Number(payment.amount ?? 0),
          currency: String(payment.currency ?? 'USD'),
          transactionDate: new Date().toISOString().slice(0, 10),
          reference: String(payment.external_reference ?? payment.payment_number ?? id),
          description: `Annulation frais de réservation — ${payment.payment_number}`,
          paymentMethod: String(payment.payment_method ?? 'BANK'),
        });
      }
      await this.repository.updateReservationPaymentStatus(
        organizationId,
        id,
        {
          status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
          cancelled_by: this.context.userId(),
          cancellation_reason: dto.reason,
        },
        client,
      );
      await this.writeSalesAuditLog(client, 'SALES_RESERVATION_PAYMENT_CANCELLED', 'sales_reservation_payments', String(id), `/api/sales/reservation-payments/${id}/cancel`, 200, {
        reason: dto.reason,
        reservation_id: payment.reservation_id,
        payment_number: payment.payment_number,
      });
    });
    return this.getReservationPayment(id);
  }

  async refundReservationPayment(id: number, dto: CreateSalesReservationRefundDto) {
    const refund = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const payment = await this.repository.findReservationPayment(organizationId, id, client);
      if (!payment) throw new NotFoundException('Reservation payment not found');
      if (String(payment.status ?? '').toUpperCase() === 'CANCELLED') {
        throw new ConflictException('Un paiement annulé ne peut pas être remboursé.');
      }
      const refunds = await this.repository.listReservationRefunds(organizationId, id, client);
      const refundedTotal = refunds
        .filter((row: any) => String(row.status ?? '').toUpperCase() === 'CONFIRMED')
        .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
      const allocationRows = await this.repository.listActiveReservationFeeAllocations(organizationId, Number(payment.reservation_id), client);
      const allocated = allocationRows
        .filter((row: any) => Number(row.reservation_payment_id ?? 0) === Number(payment.id))
        .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
      if (allocated > 0) {
        throw new ConflictException({
          code: 'PAYMENT_ALREADY_ALLOCATED',
          message: "Ce paiement est déjà affecté à une souscription. Inversez d'abord l'allocation avant de rembourser.",
        });
      }
      const maxRefundable = Number((Number(payment.amount ?? 0) - refundedTotal - allocated).toFixed(2));
      const amount = Number(dto.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Le montant du remboursement doit être strictement positif.');
      if (amount > maxRefundable + 0.0001) throw new BadRequestException('Le montant dépasse le disponible remboursable.');

      const idempotencyKey = String(dto.idempotency_key ?? [
        'SALES_RESERVATION_REFUND',
        organizationId,
        id,
        String(dto.refund_date ?? ''),
        amount.toFixed(2),
        String(dto.refund_method ?? ''),
      ].join(':'));

      const settings = await this.repository.findSettings(organizationId, client);
      const refundNumber = await this.generateReference(
        organizationId,
        'RESERVATION_REFUND',
        settings?.reservation_refund_number_format || 'RRS-{YYYY}-{SEQ:5}',
        client,
      );
      const destinationType = String(dto.destination_type ?? '').toUpperCase();
      const currency = String(payment.currency ?? 'USD').toUpperCase();
      const cashSession = destinationType === 'CASH'
        ? await this.requireOpenCashSession(organizationId, Number(dto.cash_session_id ?? 0), client)
        : null;
      const bankAccount = destinationType === 'BANK' || destinationType === 'MOBILE_MONEY'
        ? await this.requireSalesBankAccount(organizationId, Number(dto.bank_account_id ?? 0), currency, client)
        : null;

      let created = await this.repository.createReservationRefund(
        organizationId,
        this.context.userId(),
        {
          reservation_payment_id: id,
          reservation_id: payment.reservation_id,
          refund_number: refundNumber,
          refund_date: dto.refund_date,
          amount,
          currency,
          refund_method: String(dto.refund_method ?? '').toUpperCase(),
          destination_type: destinationType,
          cash_session_id: cashSession?.id ?? null,
          bank_account_id: bankAccount?.id ?? null,
          reason: dto.reason,
          idempotency_key: idempotencyKey,
          status: 'CONFIRMED',
        },
        client,
      );

      let cashMovementId: number | null = null;
      let bankTransactionId: number | null = null;
      if (destinationType === 'CASH') {
        cashMovementId = await this.createReservationCashMovement(client, {
          paymentId: Number(payment.id),
          refundId: Number(created.id),
          reservation: { reservation_number: String(payment.payment_number ?? refundNumber) },
          sessionId: Number(cashSession?.id),
          type: 'OUT',
          category: 'SALES_RESERVATION_FEE_REFUND',
          amount,
          currency,
          movementDate: dto.refund_date,
          reference: String(dto.external_reference ?? refundNumber).trim() || refundNumber,
          description: `Remboursement frais de réservation — ${payment.payment_number}`,
        });
      } else if (bankAccount) {
        bankTransactionId = await this.createReservationBankTransaction(client, {
          paymentId: Number(payment.id),
          refundId: Number(created.id),
          reservation: { reservation_number: String(payment.payment_number ?? refundNumber) },
          bankAccountId: Number(bankAccount.id),
          direction: 'OUT',
          amount,
          currency,
          transactionDate: dto.refund_date,
          reference: String(dto.external_reference ?? refundNumber).trim() || refundNumber,
          description: `Remboursement frais de réservation — ${payment.payment_number}`,
          paymentMethod: String(dto.refund_method ?? 'BANK'),
        });
      }

      created = await this.repository.updateReservationRefundLinks(
        organizationId,
        Number(created.id),
        { cash_movement_id: cashMovementId, bank_transaction_id: bankTransactionId },
        client,
      ) ?? created;

      const newRefundedTotal = refundedTotal + amount;
      const paymentStatus = newRefundedTotal >= Number(payment.amount ?? 0) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await this.repository.updateReservationPaymentStatus(organizationId, id, { status: paymentStatus }, client);
      await this.writeSalesAuditLog(client, 'SALES_RESERVATION_PAYMENT_REFUNDED', 'sales_reservation_refunds', String(created.id), `/api/sales/reservation-payments/${id}/refunds`, 201, {
        reservation_payment_id: id,
        reservation_id: payment.reservation_id,
        refund_number: refundNumber,
        amount,
        currency,
        reason: dto.reason,
        cash_movement_id: cashMovementId,
        bank_transaction_id: bankTransactionId,
      });
      return created;
    });
    await this.documents.regenerateReservationFeeReceiptFromRefund(this.context.organizationId(), Number(refund.id), this.context.userId());
    return this.getReservationPayment(id);
  }

  async regenerateReservationPaymentReceipt(id: number) {
    return this.documents.regenerateReservationFeeReceiptFromPayment(this.context.organizationId(), id, this.context.userId());
  }

  listDocumentTemplates() {
    return this.documents.listTemplates(this.context.organizationId());
  }

  createDocumentTemplate(dto: SalesDocumentTemplateDto) {
    return this.documents.createTemplate(this.context.organizationId(), this.context.userId(), dto);
  }

  updateDocumentTemplate(id: number, dto: UpdateSalesDocumentTemplateDto) {
    return this.documents.updateTemplate(this.context.organizationId(), id, this.context.userId(), dto);
  }

  listReservationDocuments(id: number) {
    return this.documents.listReservationDocuments(this.context.organizationId(), id);
  }

  regenerateReservationDocument(id: number) {
    return this.documents.regenerateReservationContract(this.context.organizationId(), id, this.context.userId());
  }

  listSubscriptionDocuments(id: number) {
    return this.documents.listSubscriptionDocuments(this.context.organizationId(), id);
  }

  regenerateSubscriptionDocument(id: number) {
    return this.documents.regenerateSubscriptionContract(this.context.organizationId(), id, this.context.userId());
  }

  downloadGeneratedDocument(id: number) {
    return this.documents.downloadDocument(this.context.organizationId(), id);
  }

  async simulateSubscription(dto: SimulateSalesSubscriptionDto) {
    const organizationId = this.context.organizationId();
    const settings = await this.repository.findSettings(organizationId);
    const source = await this.resolveSubscriptionSource(organizationId, dto);
    this.validateSubscriptionCatalog(source.currency, source.catalog);
    return simulateSalesSubscriptionPlan(
      {
        ...dto,
        buyer_id: source.buyer_id,
        catalog_item_id: source.catalog_item_id,
        project_id: source.project_id ?? undefined,
        reservation_id: source.reservation_id,
        currency: source.currency,
        catalog_price: source.catalog_price,
      },
      settings,
    );
  }

  async createSubscription(dto: CreateSalesSubscriptionDto) {
    const created = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const source = await this.resolveSubscriptionSource(organizationId, dto, client, true);
      this.validateSubscriptionCatalog(source.currency, source.catalog);
      await this.assertSubscriptionAvailability(
        organizationId,
        Number(source.catalog.id),
        client,
        source.reservation_id ?? undefined,
      );

      const simulation = simulateSalesSubscriptionPlan(
        {
          ...dto,
          buyer_id: source.buyer_id,
          catalog_item_id: source.catalog_item_id,
          project_id: source.project_id ?? undefined,
          reservation_id: source.reservation_id,
          currency: source.currency,
          catalog_price: source.catalog_price,
        },
        settings,
      );
      const subscriptionNumber = dto.subscription_number?.trim() || await this.generateReference(
        organizationId,
        'SUBSCRIPTION',
        settings?.subscription_number_format || 'SOU-{YYYY}-{SEQ:5}',
        client,
      );

      const created = await this.repository.createSubscription(
        organizationId,
        this.context.userId(),
        {
          ...dto,
          buyer_id: source.buyer_id,
          catalog_item_id: source.catalog_item_id,
          project_id: source.project_id ?? undefined,
          reservation_id: source.reservation_id,
          currency: source.currency,
          catalog_price: source.catalog_price,
        },
        subscriptionNumber,
        simulation.derived,
        client,
      );
      const allocation = await this.allocateReservationFeeToSubscription(
        client,
        Number(created.id),
        source.reservation_id ?? undefined,
        source.currency,
        Number(simulation.derived.financed_balance ?? 0),
      );
      if (allocation.allocatedAmount > 0) {
        await this.repository.updateSubscription(
          organizationId,
          Number(created.id),
          this.context.userId(),
          {
            buyer_id: source.buyer_id,
            catalog_item_id: source.catalog_item_id,
            project_id: source.project_id ?? undefined,
            reservation_id: source.reservation_id,
            currency: source.currency,
            catalog_price: source.catalog_price,
          },
          {
            ...simulation.derived,
            financed_balance: allocation.financedBalance,
          },
          client,
        );
      }
      await this.repository.replaceSubscriptionInstallments(organizationId, Number(created.id), simulation.installments, client);

      await this.repository.setBuyerCommercialStage(organizationId, source.buyer_id, 'SUBSCRIBER', this.context.userId(), client);
      await this.repository.updateCatalogStatus(organizationId, source.catalog_item_id, created.status === 'APPROVED' ? 'SOLD' : 'RESERVED', this.context.userId(), client);
      if (source.reservation && source.reservation.status !== 'CONVERTED') {
        const converted = await this.repository.transitionReservationStatus(organizationId, Number(source.reservation.id), 'CONVERTED', this.context.userId(), 'Souscription créée', client);
        await this.repository.writeStatusHistory(organizationId, 'reservation', Number(source.reservation.id), source.reservation.status, 'CONVERTED', 'Souscription créée', this.context.userId(), client);
        await this.repository.writeAuditEvent(organizationId, 'sales_reservation', Number(source.reservation.id), 'SALES_RESERVATION_CONVERTED', this.context.userId(), source.reservation, converted, client);
      }

      await this.repository.writeStatusHistory(organizationId, 'subscription', Number(created.id), null, created.status, null, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_subscription', Number(created.id), 'SALES_SUBSCRIPTION_CREATED', this.context.userId(), null, created, client);
      return created;
    });
    await this.generateSubscriptionDocumentSafely(Number(created.id));
    return this.getSubscription(Number(created.id));
  }

  async updateSubscription(id: number, dto: UpdateSalesSubscriptionDto) {
    const updated = await this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findSubscription(organizationId, id, client);
      if (!before) throw new NotFoundException('Subscription not found');
      if (!['DRAFT', 'SUBMITTED', 'REJECTED'].includes(before.status)) {
        throw new BadRequestException("Seules les souscriptions en brouillon, soumises ou rejetées peuvent être modifiées.");
      }

      const settings = await this.repository.findSettings(organizationId, client);
      const source = await this.resolveSubscriptionSource(
        organizationId,
        {
          ...before,
          ...dto,
          buyer_id: dto.buyer_id ?? before.buyer_id,
          catalog_item_id: dto.catalog_item_id ?? before.catalog_item_id,
          reservation_id: dto.reservation_id ?? before.reservation_id ?? undefined,
        } as SimulateSalesSubscriptionDto,
        client,
        true,
      );
      this.validateSubscriptionCatalog(source.currency, source.catalog);
      await this.assertSubscriptionAvailability(
        organizationId,
        Number(source.catalog.id),
        client,
        source.reservation_id ?? undefined,
        id,
      );

      const simulation = simulateSalesSubscriptionPlan(
        {
          buyer_id: source.buyer_id,
          catalog_item_id: source.catalog_item_id,
          project_id: source.project_id ?? undefined,
          reservation_id: source.reservation_id,
          currency: source.currency,
          catalog_price: source.catalog_price,
          negotiated_price: dto.negotiated_price ?? before.final_sale_price,
          discount_amount: dto.discount_amount ?? before.discount_amount ?? undefined,
          deposit_type: dto.deposit_type ?? before.deposit_type,
          deposit_percentage: dto.deposit_percentage ?? before.deposit_percentage ?? undefined,
          deposit_amount: dto.deposit_amount ?? before.deposit_amount ?? undefined,
          installment_count: dto.installment_count ?? before.installment_count,
          frequency: dto.frequency ?? before.frequency,
          first_due_date: dto.first_due_date ?? before.first_due_date ?? undefined,
          grace_period_days: dto.grace_period_days ?? before.grace_period_days ?? undefined,
          allow_custom_schedule: dto.allow_custom_schedule ?? before.allow_custom_schedule ?? undefined,
          custom_installments: dto.custom_installments,
          origin_mode: dto.origin_mode,
        },
        settings,
      );

      const after = await this.repository.updateSubscription(
        organizationId,
        id,
        this.context.userId(),
        {
          ...dto,
          buyer_id: source.buyer_id,
          catalog_item_id: source.catalog_item_id,
          project_id: source.project_id ?? undefined,
          reservation_id: source.reservation_id,
          currency: source.currency,
          catalog_price: source.catalog_price,
        },
        simulation.derived,
        client,
      );
      if (!after) throw new NotFoundException('Subscription not found');
      await this.repository.replaceSubscriptionInstallments(organizationId, id, simulation.installments, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_subscription', id, 'SALES_SUBSCRIPTION_UPDATED', this.context.userId(), before, after, client);
      return after;
    });
    await this.generateSubscriptionDocumentSafely(id);
    return this.getSubscription(Number(updated.id));
  }

  submitSubscription(id: number, reason?: string) {
    return this.changeSubscriptionStatus(id, 'SUBMITTED', reason ?? null);
  }

  approveSubscription(id: number, reason?: string) {
    return this.changeSubscriptionStatus(id, 'APPROVED', reason ?? null);
  }

  rejectSubscription(id: number, reason?: string) {
    return this.changeSubscriptionStatus(id, 'REJECTED', reason ?? null);
  }

  cancelSubscription(id: number, reason?: string) {
    return this.changeSubscriptionStatus(id, 'CANCELLED', reason ?? null);
  }

  private async ensureReservationExists(id: number) {
    const reservation = await this.repository.findReservation(this.context.organizationId(), id);
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  private async getReservationPaymentDestinations(currency: string) {
    const organizationId = this.context.organizationId();
    return {
      cash_sessions: await this.repository.listOpenCashSessions(organizationId),
      bank_accounts: await this.repository.listActiveBankAccounts(organizationId, currency),
    };
  }

  private async buildReservationFeeSummary(id: number, client?: any) {
    const row = await this.repository.getReservationFeeSummary(this.context.organizationId(), id, client);
    if (!row) {
      throw new NotFoundException('Reservation not found');
    }
    const feeAgreed = Number(row.fee_agreed ?? 0);
    const feePaid = Number(row.fee_paid ?? 0);
    const feeRefunded = Number(row.fee_refunded ?? 0);
    const feeAllocated = Number(row.fee_allocated ?? 0);
    const feeAvailable = Number((feePaid - feeRefunded - feeAllocated).toFixed(2));
    const feeRemaining = Math.max(Number((feeAgreed - feePaid).toFixed(2)), 0);
    const refundableAmount = Math.max(Number((feePaid - feeRefunded - feeAllocated).toFixed(2)), 0);
    const paymentStatus = feePaid <= 0 ? 'UNPAID' : feeRemaining > 0 ? 'PARTIALLY_PAID' : 'PAID';
    return {
      fee_agreed: feeAgreed,
      fee_paid: feePaid,
      fee_refunded: feeRefunded,
      fee_allocated: feeAllocated,
      fee_available: feeAvailable,
      fee_remaining: feeRemaining,
      payment_status: paymentStatus,
      deductibility: String(row.deductibility ?? 'DEDUCTIBLE'),
      refundable_amount: refundableAmount,
      currency: String(row.currency ?? 'USD'),
    };
  }

  private async requireOpenCashSession(organizationId: number, sessionId: number, client: any) {
    if (!sessionId) {
      throw new BadRequestException('Une session de caisse ouverte est obligatoire.');
    }
    const session = await this.repository.findOpenCashSession(organizationId, sessionId, client);
    if (!session) {
      throw new NotFoundException('Session de caisse introuvable.');
    }
    if (String(session.status ?? '').toUpperCase() !== 'OPEN') {
      throw new ConflictException({
        code: 'CASH_SESSION_CLOSED',
        message: 'La session de caisse sélectionnée est clôturée.',
      });
    }
    return session;
  }

  private devSalesLog(message: string, payload: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'production') return;
    console.info(message, payload);
  }

  private async requireSalesBankAccount(organizationId: number, bankAccountId: number, currency: string, client: any) {
    if (!bankAccountId) {
      throw new BadRequestException('Un compte financier actif est obligatoire.');
    }
    const account = await this.repository.findActiveBankAccount(organizationId, bankAccountId, client);
    if (!account) {
      throw new NotFoundException('Compte financier introuvable.');
    }
    if (String(account.status ?? '').toUpperCase() !== 'ACTIVE') {
      throw new ConflictException('Le compte financier sélectionné n’est pas actif.');
    }
    if (String(account.currency ?? '').toUpperCase() !== String(currency ?? '').toUpperCase()) {
      throw new BadRequestException('La devise du compte financier doit correspondre à celle de la réservation.');
    }
    return account;
  }

  private async createReservationCashMovement(
    client: any,
    payload: {
      paymentId: number;
      refundId?: number;
      reservation: { reservation_number?: string | null };
      sessionId: number;
      type: 'IN' | 'OUT';
      category: string;
      amount: number;
      currency: string;
      movementDate: string;
      reference: string;
      description: string;
    },
  ) {
    const { rows } = await client.query(
      `INSERT INTO cash_movements (
         cash_session_id, type, category, amount, movement_date, description, reference, currency,
         equivalent_usd, created_by, organization_id, sales_reservation_payment_id, sales_reservation_refund_id
       )
       VALUES (
         $1, $2, $3, $4, $5::date, $6, $7, $8,
         $9, $10, $11, $12, $13
       )
       RETURNING id`,
      [
        payload.sessionId,
        payload.type,
        payload.category,
        payload.amount,
        payload.movementDate,
        payload.description,
        payload.reference,
        payload.currency,
        payload.amount,
        this.context.userId() ?? null,
        this.context.organizationId(),
        payload.refundId ? null : payload.paymentId,
        payload.refundId ?? null,
      ],
    );
    return Number(rows[0]?.id ?? 0) || null;
  }

  private async createReservationBankTransaction(
    client: any,
    payload: {
      paymentId: number;
      refundId?: number;
      reservation: { reservation_number?: string | null };
      bankAccountId: number;
      direction: 'IN' | 'OUT';
      amount: number;
      currency: string;
      transactionDate: string;
      reference: string;
      description: string;
      paymentMethod: string;
    },
  ) {
    const year = new Date(payload.transactionDate || new Date().toISOString()).getUTCFullYear();
    const { rows: sequenceRows } = await client.query(
      `SELECT COALESCE(MAX((SUBSTRING(transaction_number FROM $1))::INT), 0) + 1 AS value
       FROM bank_transactions
       WHERE transaction_number LIKE $2
         AND organization_id = $3`,
      [`BTR-${year}-([0-9]+)`, `BTR-${year}-%`, this.context.organizationId()],
    );
    const transactionNumber = `BTR-${year}-${String(sequenceRows[0]?.value ?? 1).padStart(6, '0')}`;
    const { rows } = await client.query(
      `INSERT INTO bank_transactions
        (organization_id, bank_account_id, transaction_number, transaction_date, direction, transaction_type, amount, currency,
         reference, description, source_module, source_entity_type, source_entity_id, status, reversal_of_id, idempotency_key, created_by)
       VALUES
        ($1, $2, $3, $4::date, $5, 'MANUAL_ADJUSTMENT', $6, $7,
         $8, $9, 'SALES', $10, $11, 'VALIDATED', NULL, $12, $13)
       RETURNING id`,
      [
        this.context.organizationId(),
        payload.bankAccountId,
        transactionNumber,
        payload.transactionDate,
        payload.direction,
        payload.amount,
        payload.currency,
        payload.reference,
        payload.description,
        payload.refundId ? 'RESERVATION_REFUND' : 'RESERVATION_PAYMENT',
        payload.refundId ?? payload.paymentId,
        `sales-reservation:${this.context.organizationId()}:${payload.refundId ?? payload.paymentId}:${payload.direction}`,
        this.context.userId() ?? null,
      ],
    );
    return Number(rows[0]?.id ?? 0) || null;
  }

  private async writeSalesAuditLog(client: any, action: string, resource: string, resourceId: string, path: string, statusCode: number, metadata: Record<string, unknown>) {
    await client.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource, resource_id, method, path, status_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        this.context.organizationId(),
        this.context.userId() ?? null,
        action,
        resource,
        resourceId,
        'POST',
        path,
        statusCode,
        JSON.stringify(metadata),
      ],
    );
  }

  private async findLatestGeneratedDocument(entityType: string, entityId: number) {
    const rows = await this.repository.listDocumentGenerations(this.context.organizationId(), entityType as any, entityId);
    return rows[0] ?? null;
  }

  private async generateReference(
    organizationId: number,
    documentType: string,
    format: string,
    client: any,
  ) {
    const year = new Date().getUTCFullYear();
    const sequence = await this.repository.nextSequenceValue(organizationId, documentType, year, client);
    return this.repository.formatSequence(format, sequence, year);
  }

  private async allocateReservationFeeToSubscription(
    client: any,
    subscriptionId: number,
    reservationId: number | undefined,
    currency: string,
    financedBalance: number,
  ) {
    if (!reservationId || financedBalance <= 0) {
      return { financedBalance, allocatedAmount: 0 };
    }
    const settings = await this.repository.findSettings(this.context.organizationId(), client);
    const summary = await this.buildReservationFeeSummary(reservationId, client);
    const deductibility = String(settings?.reservation_fee_deductibility ?? 'DEDUCTIBLE').toUpperCase();
    let deductibleAmount = 0;
    if (deductibility === 'DEDUCTIBLE') {
      deductibleAmount = Number(summary.fee_available ?? 0);
    } else if (deductibility === 'PARTIALLY_DEDUCTIBLE') {
      deductibleAmount = Number(summary.fee_available ?? 0) * (Number(settings?.reservation_fee_deductible_percentage ?? 0) / 100);
    }
    deductibleAmount = Number(Math.max(0, Math.min(deductibleAmount, financedBalance)).toFixed(2));
    if (!(deductibleAmount > 0)) {
      return { financedBalance, allocatedAmount: 0 };
    }
    const payments = await this.repository.listReservationPayments(this.context.organizationId(), reservationId, client);
    let remaining = deductibleAmount;
    for (const payment of payments.reverse()) {
      const available = Number(payment.available_refundable_amount ?? 0);
      if (!(available > 0) || remaining <= 0) continue;
      const amount = Number(Math.min(available, remaining).toFixed(2));
      await this.repository.createReservationFeeAllocation(
        this.context.organizationId(),
        this.context.userId(),
        {
          reservation_id: reservationId,
          reservation_payment_id: payment.id,
          subscription_id: subscriptionId,
          amount,
          currency,
        },
        client,
      );
      remaining = Number((remaining - amount).toFixed(2));
    }
    const allocatedAmount = Number((deductibleAmount - remaining).toFixed(2));
    return {
      financedBalance: Number(Math.max(0, financedBalance - allocatedAmount).toFixed(2)),
      allocatedAmount,
    };
  }

  private async resolveSubscriptionSource(
    organizationId: number,
    dto: SimulateSalesSubscriptionDto,
    client?: any,
    lockCatalog = false,
  ) {
    const useReservation = String(dto.origin_mode ?? (dto.reservation_id ? 'RESERVATION' : 'DIRECT')).toUpperCase() === 'RESERVATION';
    if (useReservation) {
      if (!dto.reservation_id) {
        throw new BadRequestException('Une réservation est obligatoire pour ce mode de souscription.');
      }
      const reservation = await this.repository.findReservation(organizationId, dto.reservation_id, client);
      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }
      const catalog = lockCatalog
        ? await this.repository.lockCatalogItem(organizationId, Number(reservation.catalog_item_id), client)
        : await this.repository.findCatalogForSale(organizationId, Number(reservation.catalog_item_id), client);
      await this.repository.findBuyerForSale(organizationId, Number(reservation.buyer_id), client);
      const projectId = Number(reservation.project_id ?? catalog.project_id ?? 0) || null;
      await this.assertCatalogProjectConsistency(catalog, projectId);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, projectId, client);
      this.validateReservationLink(reservation, {
        ...dto,
        buyer_id: Number(reservation.buyer_id),
        catalog_item_id: Number(reservation.catalog_item_id),
      } as CreateSalesSubscriptionDto);
      return {
        reservation,
        reservation_id: Number(reservation.id),
        buyer_id: Number(reservation.buyer_id),
        catalog_item_id: Number(reservation.catalog_item_id),
        project_id: projectId,
        currency: String(reservation.currency),
        catalog_price: Number(reservation.catalog_price),
        catalog,
      };
    }

    const catalog = lockCatalog
      ? await this.repository.lockCatalogItem(organizationId, dto.catalog_item_id, client)
      : await this.repository.findCatalogForSale(organizationId, dto.catalog_item_id, client);
    await this.repository.findBuyerForSale(organizationId, dto.buyer_id, client);
    const projectId = dto.project_id ?? catalog.project_id ?? null;
    await this.assertCatalogProjectConsistency(catalog, projectId);
    await this.repository.ensureProjectBelongsToOrganization(organizationId, projectId, client);
    return {
      reservation: null,
      reservation_id: undefined,
      buyer_id: dto.buyer_id,
      catalog_item_id: dto.catalog_item_id,
      project_id: projectId,
      currency: dto.currency,
      catalog_price: dto.catalog_price,
      catalog,
    };
  }

  private async assertCatalogProjectConsistency(catalog: any, requestedProjectId: number | null) {
    const catalogProjectId = Number(catalog.project_id ?? 0) || null;
    if (catalogProjectId && requestedProjectId && catalogProjectId !== requestedProjectId) {
      throw new BadRequestException('Le bien sélectionné appartient à un autre projet commercial.');
    }
  }

  private async assertReservationAvailability(
    organizationId: number,
    catalogItemId: number,
    client: any,
    excludeReservationId?: number,
  ) {
    const activeReservation = await this.repository.findActiveReservationForCatalog(organizationId, catalogItemId, client, excludeReservationId);
    if (activeReservation) {
      throw new ConflictException({
        code: 'SALES_PROPERTY_NOT_AVAILABLE',
        message: 'Ce bien vient d’être réservé ou vendu. Sélectionnez un autre bien.',
      });
    }
    const activeSubscription = await this.repository.findActiveSubscriptionForCatalog(organizationId, catalogItemId, client);
    if (activeSubscription) {
      throw new ConflictException({
        code: 'SALES_PROPERTY_NOT_AVAILABLE',
        message: 'Ce bien vient d’être réservé ou vendu. Sélectionnez un autre bien.',
      });
    }
  }

  private async assertSubscriptionAvailability(
    organizationId: number,
    catalogItemId: number,
    client: any,
    reservationId?: number,
    excludeSubscriptionId?: number,
  ) {
    const activeSubscription = await this.repository.findActiveSubscriptionForCatalog(
      organizationId,
      catalogItemId,
      client,
      excludeSubscriptionId,
    );
    if (activeSubscription) {
      throw new ConflictException({
        code: 'SALES_PROPERTY_NOT_AVAILABLE',
        message: 'Ce bien vient d’être réservé ou vendu. Sélectionnez un autre bien.',
      });
    }
    const activeReservation = await this.repository.findActiveReservationForCatalog(organizationId, catalogItemId, client);
    if (activeReservation && Number(activeReservation.id) !== Number(reservationId ?? 0)) {
      throw new ConflictException({
        code: 'SALES_PROPERTY_NOT_AVAILABLE',
        message: 'Ce bien vient d’être réservé ou vendu. Sélectionnez un autre bien.',
      });
    }
  }

  private async generateReservationDocumentSafely(reservationId: number) {
    try {
      await this.documents.regenerateReservationContract(this.context.organizationId(), reservationId, this.context.userId());
    } catch {
      return;
    }
  }

  private async generateSubscriptionDocumentSafely(subscriptionId: number) {
    try {
      await this.documents.regenerateSubscriptionContract(this.context.organizationId(), subscriptionId, this.context.userId());
    } catch {
      return;
    }
  }

  private defaultReservationExpiry(reservationDate: string, durationDays?: number | null) {
    const start = new Date(`${reservationDate}T00:00:00.000Z`);
    const days = Number(durationDays ?? 7);
    start.setUTCDate(start.getUTCDate() + Math.max(0, days));
    return start.toISOString().slice(0, 10);
  }

  private async validateReservationInput(
    dto: CreateSalesReservationDto | UpdateSalesReservationDto,
    buyerId: number,
    catalog: any,
    settings: any,
    client: any,
  ) {
    if (!['DRAFT', 'AVAILABLE', 'RESERVED'].includes(String(catalog.commercial_status))) {
      throw new BadRequestException("Ce bien n'est pas disponible pour une réservation.");
    }
    if (catalog.currency && dto.currency && catalog.currency !== dto.currency) {
      throw new BadRequestException('La devise de la réservation doit correspondre à celle du bien.');
    }
    if (Number(dto.negotiated_price) < 0 || Number(dto.catalog_price) < 0) {
      throw new BadRequestException('Les montants de réservation doivent être positifs.');
    }
    if (catalog.minimum_price != null && Number(dto.negotiated_price) < Number(catalog.minimum_price)) {
      throw new BadRequestException('Le prix négocié ne peut pas être inférieur au minimum commercial autorisé.');
    }
    if (catalog.list_price != null && Number(dto.catalog_price) !== Number(catalog.list_price)) {
      throw new BadRequestException('Le prix catalogue de la réservation doit refléter le prix actuel du bien.');
    }
    const feeRequired = Boolean(settings?.reservation_fee_required);
    const minimumFee = Number(settings?.reservation_default_fee ?? 0);
    if (feeRequired && Number(dto.reservation_fee ?? 0) < minimumFee) {
      throw new BadRequestException(`Les frais de réservation minimum sont de ${minimumFee}.`);
    }
    if (!dto.reservation_date) {
      throw new BadRequestException('La date de réservation est obligatoire.');
    }
    if (!dto.expires_at) {
      throw new BadRequestException("La date d'expiration de la réservation est obligatoire.");
    }
    await this.repository.findBuyerForSale(this.context.organizationId(), buyerId, client);
  }

  private validateSubscriptionCatalog(currency: string, catalog: any) {
    if (!['AVAILABLE', 'RESERVED', 'DRAFT'].includes(String(catalog.commercial_status))) {
      throw new BadRequestException("Ce bien n'est pas disponible pour une souscription.");
    }
    if (catalog.currency && catalog.currency !== currency) {
      throw new BadRequestException('La devise de la souscription doit correspondre à celle du bien.');
    }
  }

  private validateReservationLink(reservation: any, dto: CreateSalesSubscriptionDto | UpdateSalesSubscriptionDto) {
    if (!reservation) return;
    if (Number(reservation.buyer_id) !== Number(dto.buyer_id)) {
      throw new BadRequestException("L'acquéreur de la souscription doit correspondre à celui de la réservation.");
    }
    if (Number(reservation.catalog_item_id) !== Number(dto.catalog_item_id)) {
      throw new BadRequestException('Le bien de la souscription doit correspondre à celui de la réservation.');
    }
    if (!['ACTIVE', 'CONFIRMED', 'CONVERTED'].includes(String(reservation.status))) {
      throw new BadRequestException("La réservation liée n'est pas dans un état compatible.");
    }
  }

  private changeReservationStatus(id: number, nextStatus: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'CONVERTED', reason: string | null) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findReservation(organizationId, id, client);
      if (!before) throw new NotFoundException('Reservation not found');

      const allowedTransitions: Record<string, string[]> = {
        DRAFT: ['ACTIVE', 'CANCELLED'],
        ACTIVE: ['CONFIRMED', 'EXPIRED', 'CANCELLED', 'CONVERTED'],
        CONFIRMED: ['CONVERTED', 'CANCELLED'],
      };
      if (!allowedTransitions[before.status]?.includes(nextStatus)) {
        throw new BadRequestException(`La réservation ${before.reservation_number} ne peut pas passer de ${before.status} à ${nextStatus}.`);
      }

      const after = await this.repository.transitionReservationStatus(organizationId, id, nextStatus, this.context.userId(), reason, client);
      if (!after) throw new NotFoundException('Reservation not found');

      const catalogStatus = nextStatus === 'CONFIRMED' || nextStatus === 'CONVERTED' ? 'RESERVED' : 'AVAILABLE';
      await this.repository.updateCatalogStatus(organizationId, Number(before.catalog_item_id), catalogStatus, this.context.userId(), client);
      if (nextStatus === 'CANCELLED' || nextStatus === 'EXPIRED') {
        await this.repository.setBuyerCommercialStage(organizationId, Number(before.buyer_id), 'PROSPECT', this.context.userId(), client);
      }

      await this.repository.writeStatusHistory(organizationId, 'reservation', id, before.status, nextStatus, reason, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_reservation', id, `SALES_RESERVATION_${nextStatus}`, this.context.userId(), before, after, client);
      return this.repository.findReservation(organizationId, id, client);
    });
  }

  private changeSubscriptionStatus(id: number, nextStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED', reason: string | null) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findSubscription(organizationId, id, client);
      if (!before) throw new NotFoundException('Subscription not found');

      const allowedTransitions: Record<string, string[]> = {
        DRAFT: ['SUBMITTED', 'CANCELLED'],
        SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
        REJECTED: ['SUBMITTED', 'CANCELLED'],
      };
      if (!allowedTransitions[before.status]?.includes(nextStatus)) {
        throw new BadRequestException(`La souscription ${before.subscription_number} ne peut pas passer de ${before.status} à ${nextStatus}.`);
      }

      const after = await this.repository.transitionSubscriptionStatus(organizationId, id, nextStatus, this.context.userId(), reason, client);
      if (!after) throw new NotFoundException('Subscription not found');

      if (nextStatus === 'APPROVED') {
        await this.repository.updateCatalogStatus(organizationId, Number(before.catalog_item_id), 'SOLD', this.context.userId(), client);
        await this.repository.setBuyerCommercialStage(organizationId, Number(before.buyer_id), 'BUYER', this.context.userId(), client);
      } else if (nextStatus === 'REJECTED' || nextStatus === 'CANCELLED') {
        const fallbackCatalogStatus = before.reservation_id ? 'RESERVED' : 'AVAILABLE';
        await this.repository.updateCatalogStatus(organizationId, Number(before.catalog_item_id), fallbackCatalogStatus, this.context.userId(), client);
        await this.repository.setBuyerCommercialStage(organizationId, Number(before.buyer_id), before.reservation_id ? 'RESERVING' : 'PROSPECT', this.context.userId(), client);
      }

      await this.repository.writeStatusHistory(organizationId, 'subscription', id, before.status, nextStatus, reason, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_subscription', id, `SALES_SUBSCRIPTION_${nextStatus}`, this.context.userId(), before, after, client);
      return this.getSubscription(id);
    });
  }
}
