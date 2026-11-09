// Aplica las migraciones SQL de /migrations en orden, una sola vez cada una.
// Se ejecuta en cada deploy de Vercel (npm run vercel-build) y en local con `npm run db:migrate`.
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  if (process.env.VERCEL) {
    console.error('[migrate] DATABASE_URL no está configurada en Vercel. Conecta la integración de Neon.');
    process.exit(1);
  }
  console.warn('[migrate] DATABASE_URL no está definida; se omiten las migraciones.');
  process.exit(0);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  // Bloqueo para que dos deploys simultáneos no migren a la vez.
  await client.query('SELECT pg_advisory_lock(727274)');
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    console.log(`[migrate] aplicando ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falló ${file}: ${err.message}`);
    }
  }
  console.log('[migrate] base de datos al día');
} finally {
  await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
  await client.end();
}
