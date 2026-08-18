import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  SalesProjectListQueryDto,
  SalesReservationListQueryDto,
  SalesSubscriptionListQueryDto,
  SimulateSalesSubscriptionDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesCatalogStatusDto,
  UpdateSalesProjectDto,
  UpdateSalesReservationDto,
  UpdateSalesSettingsDto,
  UpdateSalesSubscriptionDto,
} from './dto';
import { SalesRepository } from './sales.repository';
import { simulateSalesSubscriptionPlan } from './subscription-schedule';
import { SALES_MODULE_CODE } from './types';

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly repository: SalesRepository,
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
      const created = await this.repository.createBuyer(organizationId, this.context.userId(), dto, client);
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
      const created = await this.repository.createProject(organizationId, this.context.userId(), dto, client);
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
      this.repository.validateCatalogMoney(dto);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id, client);
      await this.repository.ensureBuildingBelongsToOrganization(organizationId, dto.building_id, client);
      await this.repository.ensureUnitBelongsToOrganization(organizationId, dto.unit_id, client);
      const created = await this.repository.createCatalogItem(organizationId, this.context.userId(), dto, client);
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
    return row;
  }

  createReservation(dto: CreateSalesReservationDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const buyer = await this.repository.findBuyerForSale(organizationId, dto.buyer_id, client);
      const catalog = await this.repository.findCatalogForSale(organizationId, dto.catalog_item_id, client);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? catalog.project_id ?? null, client);
      const expiresAt = dto.expires_at ?? this.defaultReservationExpiry(dto.reservation_date, settings?.reservation_default_duration_days);
      await this.validateReservationInput({ ...dto, expires_at: expiresAt }, buyer.id, catalog, settings, client);

      const reservationPrefix = settings?.reservation_prefix ?? settings?.quotation_prefix ?? 'RSV';
      const reservationNumber = dto.reservation_number?.trim()
        || await this.repository.generateScopedReference(organizationId, 'sales_reservations', 'reservation_number', reservationPrefix, client);
      const created = await this.repository.createReservation(
        organizationId,
        this.context.userId(),
        { ...dto, expires_at: expiresAt, status: dto.status ?? 'ACTIVE' },
        reservationNumber,
        client,
      );

      await this.repository.setBuyerCommercialStage(organizationId, dto.buyer_id, 'RESERVING', this.context.userId(), client);
      if ((created.status ?? 'ACTIVE') !== 'DRAFT') {
        await this.repository.updateCatalogStatus(organizationId, dto.catalog_item_id, 'RESERVED', this.context.userId(), client);
      }
      await this.repository.writeStatusHistory(organizationId, 'reservation', Number(created.id), null, created.status, null, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_reservation', Number(created.id), 'SALES_RESERVATION_CREATED', this.context.userId(), null, created, client);
      return this.repository.findReservation(organizationId, Number(created.id), client);
    });
  }

  updateReservation(id: number, dto: UpdateSalesReservationDto) {
    return this.db.transaction(async (client) => {
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
      const catalog = await this.repository.findCatalogForSale(organizationId, catalogItemId, client);
      await this.repository.findBuyerForSale(organizationId, buyerId, client);
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? before.project_id ?? catalog.project_id ?? null, client);
      await this.validateReservationInput(
        {
          buyer_id: buyerId,
          catalog_item_id: catalogItemId,
          project_id: dto.project_id ?? before.project_id ?? undefined,
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
        id,
      );

      const after = await this.repository.updateReservation(
        organizationId,
        id,
        this.context.userId(),
        { ...dto, expires_at: expiresAt },
        client,
      );
      if (!after) throw new NotFoundException('Reservation not found');
      await this.repository.writeAuditEvent(organizationId, 'sales_reservation', id, 'SALES_RESERVATION_UPDATED', this.context.userId(), before, after, client);
      return this.repository.findReservation(organizationId, id, client);
    });
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
    return { ...row, installments };
  }

  async simulateSubscription(dto: SimulateSalesSubscriptionDto) {
    const organizationId = this.context.organizationId();
    const settings = await this.repository.findSettings(organizationId);
    const catalog = await this.repository.findCatalogForSale(organizationId, dto.catalog_item_id);
    await this.repository.findBuyerForSale(organizationId, dto.buyer_id);
    await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? catalog.project_id ?? null);
    this.validateSubscriptionCatalog(dto.currency, catalog);
    return simulateSalesSubscriptionPlan(dto, settings);
  }

  createSubscription(dto: CreateSalesSubscriptionDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const settings = await this.repository.findSettings(organizationId, client);
      const catalog = await this.repository.findCatalogForSale(organizationId, dto.catalog_item_id, client);
      await this.repository.findBuyerForSale(organizationId, dto.buyer_id, client);
      const reservation = dto.reservation_id ? await this.repository.findReservation(organizationId, dto.reservation_id, client) : null;
      if (dto.reservation_id && !reservation) {
        throw new NotFoundException('Reservation not found');
      }
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? catalog.project_id ?? reservation?.project_id ?? null, client);
      this.validateSubscriptionCatalog(dto.currency, catalog);
      this.validateReservationLink(reservation, dto);

      const simulation = simulateSalesSubscriptionPlan(dto, settings);
      const prefix = settings?.contract_prefix ?? settings?.quotation_prefix ?? 'SUB';
      const subscriptionNumber = dto.subscription_number?.trim()
        || await this.repository.generateScopedReference(organizationId, 'sales_subscriptions', 'subscription_number', prefix, client);

      const created = await this.repository.createSubscription(organizationId, this.context.userId(), dto, subscriptionNumber, simulation.derived, client);
      await this.repository.replaceSubscriptionInstallments(organizationId, Number(created.id), simulation.installments, client);

      await this.repository.setBuyerCommercialStage(organizationId, dto.buyer_id, 'SUBSCRIBER', this.context.userId(), client);
      await this.repository.updateCatalogStatus(organizationId, dto.catalog_item_id, created.status === 'APPROVED' ? 'SOLD' : 'RESERVED', this.context.userId(), client);
      if (reservation && reservation.status !== 'CONVERTED') {
        const converted = await this.repository.transitionReservationStatus(organizationId, Number(reservation.id), 'CONVERTED', this.context.userId(), 'Souscription créée', client);
        await this.repository.writeStatusHistory(organizationId, 'reservation', Number(reservation.id), reservation.status, 'CONVERTED', 'Souscription créée', this.context.userId(), client);
        await this.repository.writeAuditEvent(organizationId, 'sales_reservation', Number(reservation.id), 'SALES_RESERVATION_CONVERTED', this.context.userId(), reservation, converted, client);
      }

      await this.repository.writeStatusHistory(organizationId, 'subscription', Number(created.id), null, created.status, null, this.context.userId(), client);
      await this.repository.writeAuditEvent(organizationId, 'sales_subscription', Number(created.id), 'SALES_SUBSCRIPTION_CREATED', this.context.userId(), null, created, client);
      return this.getSubscription(Number(created.id));
    });
  }

  updateSubscription(id: number, dto: UpdateSalesSubscriptionDto) {
    return this.db.transaction(async (client) => {
      const organizationId = this.context.organizationId();
      const before = await this.repository.findSubscription(organizationId, id, client);
      if (!before) throw new NotFoundException('Subscription not found');
      if (!['DRAFT', 'SUBMITTED', 'REJECTED'].includes(before.status)) {
        throw new BadRequestException("Seules les souscriptions en brouillon, soumises ou rejetées peuvent être modifiées.");
      }

      const settings = await this.repository.findSettings(organizationId, client);
      const buyerId = dto.buyer_id ?? before.buyer_id;
      const catalogItemId = dto.catalog_item_id ?? before.catalog_item_id;
      const reservationId = dto.reservation_id ?? before.reservation_id ?? undefined;
      const catalog = await this.repository.findCatalogForSale(organizationId, catalogItemId, client);
      await this.repository.findBuyerForSale(organizationId, buyerId, client);
      const reservation = reservationId ? await this.repository.findReservation(organizationId, reservationId, client) : null;
      if (reservationId && !reservation) {
        throw new NotFoundException('Reservation not found');
      }
      await this.repository.ensureProjectBelongsToOrganization(organizationId, dto.project_id ?? before.project_id ?? catalog.project_id ?? reservation?.project_id ?? null, client);

      const simulation = simulateSalesSubscriptionPlan(
        {
          buyer_id: buyerId,
          catalog_item_id: catalogItemId,
          project_id: dto.project_id ?? before.project_id ?? undefined,
          reservation_id: reservationId,
          currency: dto.currency ?? before.currency,
          catalog_price: dto.catalog_price ?? before.catalog_price,
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
        },
        settings,
      );

      const after = await this.repository.updateSubscription(organizationId, id, this.context.userId(), dto, simulation.derived, client);
      if (!after) throw new NotFoundException('Subscription not found');
      await this.repository.replaceSubscriptionInstallments(organizationId, id, simulation.installments, client);
      await this.repository.writeAuditEvent(organizationId, 'sales_subscription', id, 'SALES_SUBSCRIPTION_UPDATED', this.context.userId(), before, after, client);
      return this.getSubscription(id);
    });
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
    excludeReservationId?: number,
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
    const activeReservation = await this.repository.findActiveReservationForCatalog(this.context.organizationId(), Number(dto.catalog_item_id), client, excludeReservationId);
    if (activeReservation) {
      throw new BadRequestException('Une autre réservation active existe déjà sur ce bien.');
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
