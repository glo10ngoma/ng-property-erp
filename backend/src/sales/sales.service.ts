import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  CreateSalesReservationDto,
  CreateSalesSubscriptionDto,
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
    const documents = await this.documents.listReservationDocuments(this.context.organizationId(), id);
    return { ...row, documents };
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

  listDocumentTemplates() {
    return this.documents.listTemplates(this.context.organizationId());
  }

  createDocumentTemplate(dto: SalesDocumentTemplateDto) {
    return this.documents.createTemplate(this.context.organizationId(), this.context.userId(), dto as unknown as Record<string, unknown>);
  }

  updateDocumentTemplate(id: number, dto: UpdateSalesDocumentTemplateDto) {
    return this.documents.updateTemplate(this.context.organizationId(), id, this.context.userId(), dto as unknown as Record<string, unknown>);
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
