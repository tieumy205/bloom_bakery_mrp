import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const staticReview = JSON.parse(readFileSync('docs/database-official-static-review.json', 'utf8'));
const tests = JSON.parse(readFileSync('docs/database-official-test-results.json', 'utf8'));
const hash = createHash('sha256')
  .update(readFileSync('database/bakery_mrp_official.sql'))
  .digest('hex');
if (hash !== tests.sqlSha256 || tests.result !== 'passed')
  throw new Error('The exact SQL file must pass tests before import verification');
const counts = { ...staticReview.seedRowCounts, business_events: 0 };
const assertions = Object.entries(counts)
  .map(
    ([table, count]) =>
      `IF (SELECT count(*) FROM bakery_mrp.${table})<>${count} THEN RAISE EXCEPTION 'Seed count mismatch: ${table}'; END IF;`,
  )
  .join('\n');
const countFields = Object.keys(counts)
  .map((table) => `'${table}',(SELECT count(*) FROM bakery_mrp.${table})`)
  .join(',\n');
const sql = `\\set ON_ERROR_STOP on
DO $$ BEGIN
IF current_database()<>'bloom_bakery' THEN RAISE EXCEPTION 'Wrong target database'; END IF;
IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='bakery_mrp' AND table_type='BASE TABLE')<>25 THEN RAISE EXCEPTION 'Table count mismatch'; END IF;
IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bakery_mrp' AND NOT t.tgisinternal)<>18 THEN RAISE EXCEPTION 'Trigger count mismatch'; END IF;
IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bakery_mrp')<>11 THEN RAISE EXCEPTION 'Function count mismatch'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='bakery_mrp' AND NOT c.convalidated) THEN RAISE EXCEPTION 'Unvalidated constraints'; END IF;
IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='bakery_mrp' AND table_name IN ('schema_migrations','schema_migration','production_bom_snapshot','production_material_requirements')) THEN RAISE EXCEPTION 'Unexpected tables'; END IF;
IF EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='bakery_mrp' AND tablename='material_issue_requests' AND indexdef ~ 'UNIQUE.*production_id') THEN RAISE EXCEPTION 'Unexpected issue-count rule'; END IF;
${assertions}
END $$;
\\pset tuples_only on
\\pset format unaligned
\\o D:/bloomBakery/docs/database-official-import-results.json
SELECT jsonb_pretty(jsonb_build_object(
 'verifiedAt',clock_timestamp(),'server',inet_server_addr()::text,'port',inet_server_port(),
 'postgres',current_setting('server_version'),'database',current_database(),'schema','bakery_mrp',
 'sqlSha256','${hash}','createdNewDatabase',true,'tableCount',25,'triggerCount',18,'functionCount',11,
 'allConstraintsValidated',true,'seedRowCounts',jsonb_build_object(${countFields}),
 'testFixturesImported',false,'result','passed'
));
\\o
\\pset tuples_only off
\\pset format aligned
SELECT 'IMPORT_VERIFIED' AS result,current_database(),inet_server_port();
`;
writeFileSync('.tmp/verify-official-live.sql', sql);
console.log(
  'Prepared read-only production verification; no database connection or credentials stored.',
);
