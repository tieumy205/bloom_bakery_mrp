import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from '../src/modules/auth/password.ts';
const name = process.env.PGDATABASE || '';
if (!/^bloom_backend_test[a-z0-9_]*$/.test(name) || process.env.PGPORT !== '55439')
  throw new Error('Only dedicated test databases on port 55439 are allowed');
const admin = new pg.Pool({ database: 'postgres' });
try {
  const dir = (await admin.query('SHOW data_directory')).rows[0].data_directory
    .replaceAll('\\', '/')
    .toLowerCase();
  if (dir !== resolve('.tmp/sql-fix-pg').replaceAll('\\', '/').toLowerCase())
    throw new Error('Wrong test cluster');
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}
const db = new pg.Pool();
try {
  if ((await db.query("SELECT 1 FROM pg_namespace WHERE nspname='bakery_mrp'")).rowCount)
    throw new Error('Use a fresh test database, never reset existing data');
  await db.query(readFileSync('database/bakery_mrp_official.sql', 'utf8'));
  await db.query(readFileSync('backend/database/001_auth_permissions.sql', 'utf8'));
  for (const id of ['U01', 'U02', 'U03'])
    await db.query('UPDATE bakery_mrp.users SET password_hash=$2 WHERE user_id=$1', [
      id,
      await hashPassword('12345'),
    ]);
  await db.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bloom_backend_test_api') THEN CREATE ROLE bloom_backend_test_api LOGIN; END IF; END $$;",
  );
  await db.query(
    'GRANT USAGE ON SCHEMA bakery_mrp TO bloom_backend_test_api; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA bakery_mrp TO bloom_backend_test_api; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA bakery_mrp TO bloom_backend_test_api; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bakery_mrp TO bloom_backend_test_api;',
  );
  console.log('Test database prepared; production database untouched');
} finally {
  await db.end();
}
