import 'dotenv/config';
import knexLib from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// Vercel (serverless) sets VERCEL=1. There the filesystem is read-only and instances are
// short-lived, so SQLite and file-based secrets are not allowed.
export const IS_SERVERLESS = !!process.env.VERCEL;

function stripSslParams(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    for (const k of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'channel_binding']) u.searchParams.delete(k);
    return u.toString();
  } catch { return url; }
}

export function knexConfig() {
  const client = (process.env.DB_CLIENT || '').toLowerCase();
  const wantsPg = ['pg', 'postgres', 'postgresql'].includes(client) || (!client && !!process.env.DATABASE_URL);
  if (IS_SERVERLESS && !wantsPg) {
    throw new Error('DATABASE_URL is required on Vercel (use the Neon pooled connection string). SQLite is not supported on serverless.');
  }
  if (wantsPg) {
    // Strip ssl/sslmode query params so DATABASE_SSL is authoritative (node-pg lets URL params
    // override the ssl object, and newer drivers treat sslmode=require as strict verification).
    const url = stripSslParams(process.env.DATABASE_URL);
    // DATABASE_SSL=false disables TLS (local Postgres). Hosted Postgres (Neon / Render) needs TLS.
    const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
    return {
      client: 'pg',
      connection: url ? { connectionString: url, ssl } : {
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl
      },
      // Serverless: one instance handles one request at a time, so keep the pool tiny and let
      // idle connections go quickly (Neon's pooled -pooler endpoint multiplexes them).
      pool: IS_SERVERLESS
        ? { min: 0, max: Number(process.env.DB_POOL_MAX || 2), idleTimeoutMillis: 10000 }
        : { min: 0, max: Number(process.env.DB_POOL_MAX || 5), idleTimeoutMillis: 30000 },
      acquireConnectionTimeout: IS_SERVERLESS ? 20000 : 60000,
      migrations: { directory: path.join(ROOT, 'migrations'), loadExtensions: ['.js'] }
    };
  }
  if (client === 'mysql' || client === 'mysql2') {
    return {
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4'
      },
      pool: { min: 0, max: 10 },
      migrations: { directory: path.join(ROOT, 'migrations'), loadExtensions: ['.js'] }
    };
  }
  const file = path.resolve(ROOT, process.env.SQLITE_FILE || './data/xpos.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    pool: { afterCreate: (conn, done) => { conn.pragma('journal_mode = WAL'); conn.pragma('busy_timeout = 5000'); done(); } },
    migrations: { directory: path.join(ROOT, 'migrations'), loadExtensions: ['.js'] }
  };
}

// Postgres returns BIGINT (int8) and NUMERIC as strings; parse them to JS numbers.
// Our bigints are epoch-ms timestamps and sequence numbers, far below 2^53.
const config = knexConfig();
if (config.client === 'pg') {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));   // int8
  pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric
}

export const db = knexLib(config);
export const isMysql = db.client.config.client === 'mysql2';
export const isPg = db.client.config.client === 'pg';
export const isSqlite = !isMysql && !isPg;
export const lockRows = isMysql || isPg;

// Serialize startup work (migrations + demo seed) across processes on Postgres, e.g. several
// serverless instances cold-starting at once. Uses a transaction-scoped advisory lock (works
// through Neon's PgBouncer "-pooler" endpoint) on its own one-connection client, so the main
// pool stays free for the work itself.
export async function withInitLock(fn) {
  if (!isPg) return fn();
  const lockDb = knexLib({ ...config, pool: { min: 0, max: 1 } });
  const trx = await lockDb.transaction();
  try {
    await trx.raw('select pg_advisory_xact_lock(?)', [740917]);
    return await fn();
  } finally {
    await trx.commit().catch(() => {});
    await lockDb.destroy().catch(() => {});
  }
}

export function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (IS_SERVERLESS) throw new Error('JWT_SECRET env var is required on Vercel');
  const f = path.join(ROOT, 'data', '.jwt_secret');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, [...Array(48)].map(() => Math.random().toString(36)[2]).join('') + Date.now());
  return fs.readFileSync(f, 'utf8').trim();
}
