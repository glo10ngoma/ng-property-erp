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
      SELECT b.*,
             COUNT(u.id)::INT AS real_unit_count,
             CASE WHEN COUNT(u.id) > 0 THEN COUNT(u.id)::INT ELSE COALESCE(b.total_units, 0)::INT END AS unit_count,
             COUNT(*) FILTER (WHERE u.status = 'OCCUPIED')::INT AS occupied_count,
             CASE
               WHEN COUNT(u.id) > 0 THEN COUNT(*) FILTER (WHERE u.status IN ('VACANT', 'AVAILABLE'))::INT
               ELSE COALESCE(b.total_units, 0)::INT
             END AS vacant_count
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
      `SELECT b.*,
              COUNT(u.id)::INT AS real_unit_count,
              CASE WHEN COUNT(u.id) > 0 THEN COUNT(u.id)::INT ELSE COALESCE(b.total_units, 0)::INT END AS unit_count,
              COUNT(*) FILTER (WHERE u.status = 'OCCUPIED')::INT AS occupied_count,
              CASE
                WHEN COUNT(u.id) > 0 THEN COUNT(*) FILTER (WHERE u.status IN ('VACANT', 'AVAILABLE'))::INT
                ELSE COALESCE(b.total_units, 0)::INT
              END AS vacant_count
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
      `INSERT INTO buildings (
         name, address, city, building_type, state, commune, floors_count, total_units,
         manager_name, manager_phone, manager_email, observations, description, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::INT, NULLIF($8, '')::INT, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        dto.name,
        dto.address,
        dto.city,
        dto.building_type ?? 'Residence',
        dto.state ?? 'EXPLOITED',
        dto.commune ?? null,
        dto.floors_count ?? null,
        dto.total_units ?? null,
        dto.manager_name ?? null,
        dto.manager_phone ?? null,
        dto.manager_email ?? null,
        dto.observations ?? dto.description ?? null,
        dto.description ?? dto.observations ?? null,
        organizationId,
      ],
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
           building_type = COALESCE($5, building_type),
           state = COALESCE($6, state),
           commune = COALESCE($7, commune),
           floors_count = COALESCE(NULLIF($8, '')::INT, floors_count),
           total_units = COALESCE(NULLIF($9, '')::INT, total_units),
           manager_name = COALESCE($10, manager_name),
           manager_phone = COALESCE($11, manager_phone),
           manager_email = COALESCE($12, manager_email),
           observations = COALESCE($13, observations),
           description = COALESCE($14, description)
       WHERE id = $1 AND organization_id = $15 AND deleted_at IS NULL RETURNING *`,
      [
        id,
        dto.name,
        dto.address,
        dto.city,
        dto.building_type,
        dto.state,
        dto.commune,
        dto.floors_count,
        dto.total_units,
        dto.manager_name,
        dto.manager_phone,
        dto.manager_email,
        dto.observations ?? dto.description,
        dto.description ?? dto.observations,
        this.context.organizationId(),
      ],
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
