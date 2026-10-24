import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pool, transaction } from './core/db.ts';
const path = 'backend/.env.local',
  adminPath = 'backend/.env.admin.local',
  role = 'bloom_bakery_api';
try {
  const config = readFileSync(path, 'utf8');
  const existing = (await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
  if (existing) {
    if (!new RegExp(`^PGUSER=${role}$`, 'm').test(config))
      throw new Error('Role already exists; do not reset an unrelated role password');
    console.log('Existing application role preserved');
  } else {
    if (!existsSync(adminPath)) writeFileSync(adminPath, config);
    const secret = randomBytes(32).toString('hex');
    await transaction(async (db) => {
      const ddl = (
        await db.query(
          "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text,$2::text) AS sql",
          [role, secret],
        )
      ).rows[0].sql;
      await db.query(ddl);
      await db.query(`GRANT CONNECT ON DATABASE bloom_bakery TO ${role}`);
      await db.query(`GRANT USAGE ON SCHEMA bakery_mrp TO ${role}`);
      await db.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA bakery_mrp TO ${role}`,
      );
      await db.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA bakery_mrp TO ${role}`);
      await db.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bakery_mrp TO ${role}`);
    });
    writeFileSync(
      path,
      config
        .replace(/^PGUSER=.*$/m, `PGUSER=${role}`)
        .replace(/^PGPASSWORD=.*$/m, `PGPASSWORD=${secret}`)
        .replace(
          /^FRONTEND_ORIGIN=.*$/m,
          'FRONTEND_ORIGIN=http://127.0.0.1:5173,http://localhost:5173',
        ),
    );
    console.log(
      'Created application role without superuser/DDL rights. Private local config updated; credentials not logged.',
    );
  }
} finally {
  await pool.end();
}
