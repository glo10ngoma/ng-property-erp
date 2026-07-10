import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);
  private readonly safeConfig: {
    hasDatabaseUrl: boolean;
    host: string;
    port: string;
    database: string;
    sslEnabled: boolean;
    sslMode: string;
  };

  constructor(config: ConfigService) {
    const databaseUrl = config.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('Missing required environment variable DATABASE_URL');
    }

    const parsedUrl = this.parseDatabaseUrl(databaseUrl);
    const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase() ?? '';
    const sslEnabled =
      config.get<string>('DATABASE_SSL') === 'true' ||
      sslMode === 'require' ||
      parsedUrl.hostname.includes('supabase.com');

    this.safeConfig = {
      hasDatabaseUrl: true,
      host: parsedUrl.hostname,
      port: parsedUrl.port || '(default)',
      database: parsedUrl.pathname.replace(/^\//, '') || '(default)',
      sslEnabled,
      sslMode: sslMode || '(not set)',
    };

    this.logger.log(
      `Database config loaded: present=yes host=${this.safeConfig.host} port=${this.safeConfig.port} database=${this.safeConfig.database} ssl=${sslEnabled ? 'enabled' : 'disabled'} sslmode=${this.safeConfig.sslMode}`,
    );

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    });

    this.pool.on('error', (error) => {
      this.logDatabaseError('Pool idle client error', error);
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params).catch((error) => {
      throw this.mapDatabaseError(error, `Query failed: ${this.summarizeSql(text)}`);
    });
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect().catch((error) => {
      throw this.mapDatabaseError(error, 'Unable to open database transaction');
    });
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async ping() {
    await this.query('SELECT 1');
  }

  getSafeConfig() {
    return this.safeConfig;
  }

  private parseDatabaseUrl(databaseUrl: string) {
    try {
      return new URL(databaseUrl);
    } catch (error) {
      this.logger.error(`Invalid DATABASE_URL format: ${String(error)}`);
      throw new Error('Invalid DATABASE_URL format');
    }
  }

  private summarizeSql(text: string) {
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  private isConnectivityError(error: any) {
    const codes = new Set([
      'EACCES',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      '57P01',
      '08001',
      '08006',
    ]);

    if (codes.has(error?.code)) return true;
    if (Array.isArray(error?.errors)) return error.errors.some((entry: any) => codes.has(entry?.code));
    return error?.name === 'AggregateError';
  }

  private logDatabaseError(context: string, error: any) {
    const aggregateErrors = Array.isArray(error?.errors)
      ? error.errors.map((entry: any) => ({
          name: entry?.name,
          code: entry?.code,
          errno: entry?.errno,
          syscall: entry?.syscall,
          address: entry?.address,
          port: entry?.port,
          message: entry?.message,
        }))
      : undefined;

    this.logger.error(
      `${context} | host=${this.safeConfig.host} port=${this.safeConfig.port} database=${this.safeConfig.database} ssl=${this.safeConfig.sslEnabled ? 'enabled' : 'disabled'} code=${error?.code ?? 'unknown'} message=${error?.message ?? '(empty)'}`,
      error?.stack,
    );

    if (aggregateErrors?.length) {
      this.logger.error(`AggregateError details: ${JSON.stringify(aggregateErrors)}`);
    }
  }

  private mapDatabaseError(error: any, context: string) {
    this.logDatabaseError(context, error);

    if (this.isConnectivityError(error)) {
      return new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database unavailable',
      });
    }

    return error;
  }
}
