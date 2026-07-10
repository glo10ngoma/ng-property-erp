const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function safeConfig(raw) {
  const parsed = new URL(raw);
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase() ?? '';
  const sslEnabled =
    process.env.DATABASE_SSL === 'true' ||
    sslMode === 'require' ||
    parsed.hostname.includes('supabase.com');

  return {
    hasDatabaseUrl: Boolean(raw),
    host: parsed.hostname,
    port: parsed.port || '(default)',
    database: parsed.pathname.replace(/^\//, '') || '(default)',
    sslEnabled,
    sslMode: sslMode || '(not set)',
  };
}

function serializeAggregateErrors(error) {
  if (!Array.isArray(error?.errors)) return undefined;
  return error.errors.map((entry) => ({
    name: entry?.name,
    code: entry?.code,
    errno: entry?.errno,
    syscall: entry?.syscall,
    address: entry?.address,
    port: entry?.port,
    message: entry?.message,
  }));
}

async function main() {
  loadLocalEnv();

  if (!process.env.DATABASE_URL) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: 'MISSING_DATABASE_URL',
          message: 'Missing required environment variable DATABASE_URL',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const config = safeConfig(process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: config.sslEnabled ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const nowResult = await client.query('SELECT NOW() AS now, current_database() AS database_name');
    const oneResult = await client.query('SELECT 1 AS ok');
    console.log(
      JSON.stringify(
        {
          ok: true,
          config,
          checks: {
            now: nowResult.rows[0].now,
            database: nowResult.rows[0].database_name,
            select1: oneResult.rows[0].ok,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          config,
          name: error?.name,
          code: error?.code,
          message: error?.message,
          stack: error?.stack,
          errors: serializeAggregateErrors(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main();
