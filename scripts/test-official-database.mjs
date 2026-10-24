import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const at = arg.indexOf('=');
    return [arg.slice(0, at), arg.slice(at + 1)];
  }),
);
const database = args['--database'],
  port = args['--port'] || '55439';
if (!/^bloom_test_official_[a-z0-9]+$/.test(database || ''))
  throw new Error('Use a new dedicated bloom_test_official_* database');
const psql = args['--psql'] || 'D:\\PostgreSQL\\18\\bin\\psql.exe';
const base = [
  '-X',
  '-w',
  '-h',
  '127.0.0.1',
  '-p',
  port,
  '-U',
  'postgres',
  '-d',
  database,
  '-v',
  'ON_ERROR_STOP=1',
  '-q',
];
function run(extra) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(psql, [...base, ...extra], { windowsHide: true });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}
const query = (sql) => run(['-A', '-t', '-c', sql]);
function check(ok, message) {
  if (!ok) throw new Error(message);
  console.log(`PASS: ${message}`);
}
const directory = await query('SHOW data_directory');
check(
  directory.code === 0 &&
    directory.stdout.trim().replaceAll('\\', '/').toLowerCase() ===
      resolve('.tmp/sql-fix-pg').replaceAll('\\', '/').toLowerCase(),
  'Dedicated temporary cluster only',
);
const empty = await query(
  "SELECT NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='bakery_mrp')",
);
check(empty.code === 0 && empty.stdout.trim() === 't', 'Fresh empty test database');
const file = readFileSync('database/bakery_mrp_official.sql');
const restored = await run(['-f', resolve('database/bakery_mrp_official.sql')]);
if (restored.code !== 0) throw new Error(restored.stderr);
check(true, 'Official SQL restores without errors');
const workflows = await run(['-f', resolve('database/tests/official-workflows.sql')]);
if (workflows.code !== 0) throw new Error(workflows.stderr);
const workflowAssertions = (workflows.stderr.match(/NOTICE:\s+PASS:/g) || []).length;
check(workflowAssertions > 40, `${workflowAssertions} workflow assertions`);
const setup = await run(['-f', resolve('database/tests/official-concurrency.sql')]);
if (setup.code !== 0) throw new Error(setup.stderr);
const approvals = await Promise.all(
  ['OCMI1', 'OCMI2'].map((id) =>
    query(
      `BEGIN; SET LOCAL search_path=bakery_mrp,pg_temp; UPDATE material_issue_requests SET status='approved',approved_by='OCMGR' WHERE material_issue_request_id='${id}'; SELECT pg_sleep(1); COMMIT;`,
    ),
  ),
);
check(
  approvals.filter((r) => r.code === 0).length === 1 &&
    approvals.filter((r) => r.stderr.includes('không đủ')).length === 1,
  'Concurrent stock approvals: exactly one succeeds',
);
const stock = await query(
  "SELECT stock_quantity || ',' || (SELECT count(*) FROM bakery_mrp.material_issue_requests WHERE material_issue_request_id IN ('OCMI1','OCMI2') AND status='approved') || ',' || (SELECT count(*) FROM bakery_mrp.material_transactions WHERE record_id IN ('OCMI1','OCMI2')) FROM bakery_mrp.materials WHERE material_id='OCFL'",
);
check(
  stock.code === 0 && stock.stdout.trim() === '1.000000,1,1',
  'Concurrent loser rolls back stock, status and ledger',
);
const versions = await Promise.all(
  ['1.0', '2.0'].map((version, i) =>
    query(
      `BEGIN; SET LOCAL search_path=bakery_mrp,pg_temp; INSERT INTO bom(bom_id,product_id,version_code,unit_id,created_by) VALUES('OCBV${i + 1}','OCNEW','${version}','OCU','OCMGR'); SELECT pg_sleep(1); COMMIT;`,
    ),
  ),
);
check(
  versions.filter((r) => r.code === 0).length === 1 &&
    versions.filter((r) => r.stderr.includes('idx_active_bom')).length === 1,
  'Concurrent BOM creation allows only one active version',
);
const active = await query(
  "SELECT count(*) FROM bakery_mrp.bom WHERE product_id='OCNEW' AND is_active",
);
check(
  active.code === 0 && active.stdout.trim() === '1',
  'One active BOM remains after concurrent creation',
);
const version = await query('SHOW server_version');
const result = {
  checkedAt: new Date().toISOString(),
  postgres: version.stdout.trim(),
  database,
  sqlSha256: createHash('sha256').update(file).digest('hex'),
  restore: 'passed',
  workflowAssertions,
  concurrencyAssertions: 4,
  scope:
    'Dedicated temporary PostgreSQL cluster only; workflow test rolls back; concurrency fixtures stay only in disposable test database. Backend-only rules are not API-tested.',
  result: 'passed',
};
writeFileSync('docs/database-official-test-results.json', JSON.stringify(result, null, 2) + '\n');
writeFileSync('.tmp/official-workflow-evidence.log', workflows.stderr);
