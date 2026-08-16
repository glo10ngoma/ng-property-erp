import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { DatabaseService } from '../database/database.service';
import {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesProjectListQueryDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesCatalogStatusDto,
  UpdateSalesProjectDto,
  UpdateSalesSettingsDto,
} from './dto';
import { SalesRepository } from './sales.repository';
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
}
