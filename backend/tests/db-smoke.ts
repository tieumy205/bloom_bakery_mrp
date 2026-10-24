import assert from 'node:assert/strict';
import { pool, transaction } from '../src/core/db.ts';
try {
  assert.equal(
    (await pool.query('SELECT current_database() AS name')).rows[0].name,
    'bloom_bakery',
  );
  // Temporary table exists only in this transaction, no business data is changed.
  await assert.rejects(
    transaction(async (db) => {
      await db.query('CREATE TEMP TABLE bloom_rollback_probe(value int) ON COMMIT DROP');
      await db.query('INSERT INTO bloom_rollback_probe VALUES(1)');
      throw new Error('rollback probe');
    }),
    /rollback probe/,
  );
  await transaction(async (db) => {
    assert.equal(
      (await db.query("SELECT to_regclass('pg_temp.bloom_rollback_probe') AS name")).rows[0].name,
      null,
    );
  });
  console.log('PASS: PostgreSQL connection and transaction rollback');
} finally {
  await pool.end();
}
