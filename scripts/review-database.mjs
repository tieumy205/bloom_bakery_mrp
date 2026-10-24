import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { permissions } from '../src/shared/domain/permissions.ts';

// Read-only audit of a plain pg_dump file. Do not execute the supplied SQL.
const sql = readFileSync(process.argv[2], 'utf8');
const tables = new Map();
for (const match of sql.matchAll(
  /COPY bakery_mrp\.(\w+) \(([^\n]+)\) FROM stdin;\r?\n([\s\S]*?)^\\\.\r?$/gm,
)) {
  const columns = match[2].split(',').map((column) => column.trim());
  const lines = match[3].split(/\r?\n/).filter(Boolean);
  const badRows = lines.filter((line) => line.split('\t').length !== columns.length).length;
  const rows = lines.map((line) =>
    Object.fromEntries(
      line.split('\t').map((value, i) => [columns[i], value === '\\N' ? null : value]),
    ),
  );
  tables.set(match[1], { rows, badRows });
}
const rows = (name) => tables.get(name)?.rows || [];
const modules = new Map(rows('modules').map((row) => [row.module_id, row.code]));
const roleNames = new Map(rows('roles').map((row) => [row.role_id, row.name]));
const permissionById = new Map(
  rows('permissions').map((row) => [
    row.permission_id,
    `${modules.get(row.module_id)}:${row.action}`,
  ]),
);
const granted = new Map([...roleNames.values()].map((role) => [role, new Set()]));
for (const row of rows('role_permissions'))
  granted.get(roleNames.get(row.role_id))?.add(permissionById.get(row.permission_id));
const mapping = {
  materials: 'materials',
  products: 'products',
  boms: 'bom',
  orders: 'production_orders',
  requests: 'material_replenishment_requests',
  receipts: 'material_receipt_notes',
  'material-issues': 'material_issue_requests',
  'product-issues': 'product_issue_requests',
  reports: 'statistics',
  users: 'users',
  permissions: 'access_control',
};
const differences = {};
for (const [role, modulesByRole] of Object.entries(permissions)) {
  const expected = new Set(
    Object.entries(modulesByRole).flatMap(([module, actions]) =>
      mapping[module] ? actions.map((action) => `${mapping[module]}:${action}`) : [],
    ),
  );
  const actual = granted.get(role) || new Set();
  differences[role] = {
    missing: [...expected].filter((key) => !actual.has(key)),
    extra: [...actual].filter((key) => !expected.has(key)),
  };
}
const moduleIdByCode = new Map([...modules.entries()].map(([id,code]) => [code,id]));
const repairedModule = (permission) =>
  permission.permission_id.startsWith('P09_')
    ? moduleIdByCode.get('bom')
    : permission.permission_id.startsWith('P10_')
      ? moduleIdByCode.get('users')
      : permission.permission_id.startsWith('P11_')
        ? moduleIdByCode.get('access_control')
        : permission.module_id;
const repairedPermissionById = new Map(
  rows('permissions').map((permission) => [
    permission.permission_id,
    `${modules.get(repairedModule(permission))}:${permission.action}`,
  ]),
);
const repairedGrants = new Map([...roleNames.values()].map((role) => [role, new Set()]));
for (const row of rows('role_permissions'))
  repairedGrants
    .get(roleNames.get(row.role_id))
    ?.add(repairedPermissionById.get(row.permission_id));
const repairedDifferences = {};
for (const [role, modulesByRole] of Object.entries(permissions)) {
  const expected = new Set(
    Object.entries(modulesByRole).flatMap(([module, actions]) =>
      mapping[module] ? actions.map((action) => `${mapping[module]}:${action}`) : [],
    ),
  );
  const actual = repairedGrants.get(role) || new Set();
  repairedDifferences[role] = {
    missing: [...expected].filter((key) => !actual.has(key)),
    extra: [...actual].filter((key) => !expected.has(key)),
  };
}
const stockMismatches = [];
const foreignKeyViolations = [];
for (const match of sql.matchAll(
  /ALTER TABLE ONLY bakery_mrp\.(\w+)\s+ADD CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\) REFERENCES bakery_mrp\.(\w+)\(([^)]+)\)/g,
)) {
  const [, child, constraint, childText, parent, parentText] = match;
  const childKeys = childText.split(',').map((value) => value.trim());
  const parentKeys = parentText.split(',').map((value) => value.trim());
  const parentValues = new Set(
    rows(parent).map((row) => parentKeys.map((key) => row[key]).join('\0')),
  );
  const missing = rows(child).filter(
    (row) =>
      childKeys.every((key) => row[key] !== null) &&
      !parentValues.has(childKeys.map((key) => row[key]).join('\0')),
  );
  if (missing.length)
    foreignKeyViolations.push({
      child,
      parent,
      constraint,
      count: missing.length,
      values: [...new Set(missing.map((row) => childKeys.map((key) => row[key]).join(',')))],
    });
}
for (const [itemTable, txTable, key] of [
  ['materials', 'material_transactions', 'material_id'],
  ['products', 'product_transactions', 'product_id'],
]) {
  for (const item of rows(itemTable)) {
    const movements = rows(txTable)
      .filter((tx) => tx[key] === item[key])
      .sort(
        (a, b) =>
          Date.parse(a.created_at) - Date.parse(b.created_at) ||
          Number(
            a[`${itemTable === 'materials' ? 'material' : 'product'}_transaction_id`].slice(2),
          ) -
            Number(
              b[`${itemTable === 'materials' ? 'material' : 'product'}_transaction_id`].slice(2),
            ),
      );
    if (movements.length && Number(movements.at(-1).balance_after) !== Number(item.stock_quantity))
      stockMismatches.push({
        item: item[key],
        stock: item.stock_quantity,
        latestBalance: movements.at(-1).balance_after,
      });
  }
}
const definitionColumns = new Map();
for (const match of sql.matchAll(/CREATE TABLE bakery_mrp\.(\w+) \(([\s\S]*?)\n\);/g)) {
  definitionColumns.set(
    match[1],
    [
      ...match[2].matchAll(/^\s+(\w+)\s+(?:character|numeric|integer|timestamp|text|boolean)/gm),
    ].map((m) => m[1]),
  );
}
console.log(
  JSON.stringify(
    {
      sourceSha256: createHash('sha256').update(sql).digest('hex'),
      method: 'Static parse only; SQL was not executed. RBAC repair is simulated in memory only.',
      tableCount: definitionColumns.size,
      copyColumnErrors: [...tables]
        .filter(([, value]) => value.badRows)
        .map(([table, value]) => ({ table, badRows: value.badRows })),
      foreignKeyViolations,
      modules: [...modules.values()],
      rolePermissionDifferences: differences,
      rolePermissionDifferencesAfterSimulatedModuleIdRepair: repairedDifferences,
      currentStockVsLatestLedger: stockMismatches,
      nonzeroStockWithoutLedger: [
        ['materials', 'material_transactions', 'material_id'],
        ['products', 'product_transactions', 'product_id'],
      ].flatMap(([itemTable, txTable, key]) =>
        rows(itemTable)
          .filter(
            (item) =>
              Number(item.stock_quantity) !== 0 &&
              !rows(txTable).some((tx) => tx[key] === item[key]),
          )
          .map((item) => item[key]),
      ),
      usersWithNoPasswordHash: rows('users').filter((user) => !user.password_hash).length,
      usersWithNoEmail: rows('users').filter((user) => !user.email).length,
      bomUnitMismatches: rows('bom')
        .filter(
          (bom) =>
            rows('products').find((product) => product.product_id === bom.product_id)?.unit_id !==
            bom.unit_id,
        )
        .map((bom) => bom.bom_id),
      postedDocumentsMissingReviewMetadata: [
        'material_replenishment_requests',
        'material_issue_requests',
        'product_issue_requests',
      ].map((table) => ({
        table,
        count: rows(table).filter(
          (doc) => ['approved', 'rejected', 'fulfilled'].includes(doc.status) && !doc.reviewed_at,
        ).length,
      })),
    },
    null,
    2,
  ),
);
