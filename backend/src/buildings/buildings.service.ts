import { Injectable } from '@nestjs/common';
import { RequestContext } from '../auth/request-context';
import { requireRow } from '../common/not-found';
import { DatabaseService } from '../database/database.service';
import { CreateBuildingDto, UpdateBuildingDto } from './dto';

@Injectable()
export class BuildingsService {
  constructor(private readonly db: DatabaseService, private readonly context: RequestContext) {}

  async findAll() {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(`
      SELECT b.*, COUNT(u.id)::INT AS unit_count
      FROM buildings b
      LEFT JOIN units u ON u.building_id = b.id AND u.deleted_at IS NULL
      WHERE b.organization_id = $1 AND b.deleted_at IS NULL
      GROUP BY b.id
      ORDER BY b.name
    `, [organizationId]);
    return rows;
  }

  async findOne(id: number) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `SELECT b.*, COUNT(u.id)::INT AS unit_count
       FROM buildings b
       LEFT JOIN units u ON u.building_id = b.id AND u.deleted_at IS NULL
       WHERE b.id = $1 AND b.organization_id = $2 AND b.deleted_at IS NULL
       GROUP BY b.id`,
      [id, organizationId],
    );
    return requireRow(rows[0], 'Building');
  }

  async create(dto: CreateBuildingDto) {
    const organizationId = this.context.organizationId();
    const { rows } = await this.db.query(
      `INSERT INTO buildings (name, address, city, description, organization_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dto.name, dto.address, dto.city, dto.description ?? null, organizationId],
    );
    return rows[0];
  }

  async update(id: number, dto: UpdateBuildingDto) {
    await this.findOne(id);
    const { rows } = await this.db.query(
      `UPDATE buildings
       SET name = COALESCE($2, name),
           address = COALESCE($3, address),
           city = COALESCE($4, city),
           description = COALESCE($5, description)
       WHERE id = $1 AND organization_id = $6 AND deleted_at IS NULL RETURNING *`,
      [id, dto.name, dto.address, dto.city, dto.description, this.context.organizationId()],
    );
    return rows[0];
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.db.query('UPDATE buildings SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1 AND organization_id = $3', [
      id,
      this.context.userId(),
      this.context.organizationId(),
    ]);
    return { deleted: true };
  }
}
