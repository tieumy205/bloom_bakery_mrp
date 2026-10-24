import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-official-database.mjs <source.sql>');
const bytes = readFileSync(source);
const sourceHash = createHash('sha256').update(bytes).digest('hex');
let sql = bytes.toString('utf8').replace(/\r\n/g, '\n');
const originalTriggers = [...sql.matchAll(/^CREATE TRIGGER (\w+) .*? ON bakery_mrp\.(\w+)/gm)].map(
  (m) => `${m[2]}.${m[1]}`,
);
const originalFunctions = [
  ...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION bakery_mrp\.(\w+)/gm),
].map((m) => m[1]);
const data = new Map();
const copyPattern = /COPY bakery_mrp\.(\w+) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm;
const stamp = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}(?::\d{2})?`;
const joinedStamps = new RegExp(`(${stamp}) +(?=${stamp}\\t)`, 'g');
function decodeCopy(value) {
  if (value === '\\N') return null;
  return value.replace(/\\(?:([0-7]{1,3})|x([0-9a-f]{1,2})|(.))/gi, (_, octal, hex, char) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[char] ?? char;
  });
}
sql = sql.replace(copyPattern, (_, table, names, body) => {
  const columns = names.split(',').map((name) => name.trim());
  const rows = body
    .split('\n')
    .filter((line) => line.length)
    .map((line) => {
      if (table === 'bom')
        line = line.replace(
          /^(BOM\w+)\t(\w+)[ \t]+(\d+[.,]\d+)[ \t]+(t|f)[ \t]+(\w+)\t/,
          (_, id, product, version, active, unit) =>
            [id, product, version.replace(',', '.'), active, unit, ''].join('\t'),
        );
      if (['material_receipt_notes', 'production_orders'].includes(table))
        line = line.replace(joinedStamps, '$1\t');
      const fields = line.split('\t');
      if (fields.length !== columns.length)
        throw new Error(`${table}: malformed COPY column count`);
      return Object.fromEntries(fields.map((value, i) => [columns[i], decodeCopy(value)]));
    });
  data.set(table, { columns, rows });
  return `-- SEED:${table}`;
});
if (data.size !== 24)
  throw new Error('Expected the 24-table source dump; review a changed source before rebuilding.');
const rows = (table) => data.get(table)?.rows ?? [];
function addDataColumn(table, name, valueFor) {
  const section = data.get(table);
  if (section.columns.includes(name)) throw new Error(`${table}.${name} already exists in source`);
  section.columns.push(name);
  section.rows.forEach((row) => {
    row[name] = valueFor(row);
  });
}
const localDay = (raw) => {
  if (raw === null) return null;
  const time = new Date(raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid source timestamp');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
};
for (const [table, columns] of [
  ['product_transactions', ['quantity_change', 'balance_before', 'balance_after']],
  ['products', ['stock_quantity']],
  ['production_order_details', ['target_quantity', 'completed_quantity']],
  ['product_issue_request_details', ['request_quantity']],
])
  for (const row of rows(table))
    for (const column of columns) {
      const value = row[column];
      if (!/^[+-]?\d+(?:\.0+)?$/.test(value))
        throw new Error(`${table}.${column}: noninteger source value`);
      row[column] = value.replace(/\.0+$/, '');
      if (BigInt(row[column]) > 2147483647n || BigInt(row[column]) < -2147483648n)
        throw new Error(`${table}.${column}: integer overflow`);
    }
for (const row of rows('bom')) row.version_code = row.version_code.replace(',', '.');
const inferredBomAssignments = [];
addDataColumn('production_order_details', 'bom_id', (row) => {
  const candidates = rows('bom').filter((bom) => bom.product_id === row.product_id);
  if (candidates.length !== 1)
    throw new Error('Cannot determine historical BOM unambiguously; manual mapping required');
  inferredBomAssignments.push({
    detailId: row.production_order_detail_id,
    bomId: candidates[0].bom_id,
  });
  return candidates[0].bom_id;
});
for (const row of rows('material_receipt_notes')) row.receipt_date = localDay(row.receipt_date);
for (const row of rows('production_orders')) row.due_date = localDay(row.due_date);
for (const table of ['users', 'materials', 'products'])
  addDataColumn(table, 'created_at', () => null);
for (const table of ['material_transactions', 'product_transactions'])
  addDataColumn(table, 'business_date', (row) => {
    if (table === 'material_transactions' && row.record_name === 'material_receipt_notes') {
      const receipt = rows('material_receipt_notes').find(
        (note) => note.material_receipt_note_id === row.record_id,
      );
      if (!receipt) throw new Error('Receipt ledger has no matching receipt');
      return receipt.receipt_date;
    }
    return localDay(row.created_at);
  });

function changeTable(name, change) {
  const pattern = new RegExp(`CREATE TABLE bakery_mrp\\.${name} \\([\\s\\S]*?\\n\\);`);
  const found = sql.match(pattern)?.[0];
  if (!found) throw new Error(`Missing table ${name}`);
  const modified = change(found);
  sql = sql.replace(pattern, () => modified);
}
changeTable('bom', (text) =>
  text.replace(
    'version_code numeric(2,1)',
    "version_code character varying(20) NOT NULL CHECK (btrim(version_code) <> '')",
  ),
);
changeTable('production_order_details', (text) =>
  text.replace(
    '    product_id character varying(20) NOT NULL,',
    '    product_id character varying(20) NOT NULL,\n    bom_id character varying(20) NOT NULL,',
  ),
);
changeTable('material_receipt_notes', (text) =>
  text.replace(
    'receipt_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL',
    'receipt_date date NOT NULL',
  ),
);
changeTable('production_orders', (text) =>
  text.replace('due_date timestamp with time zone', 'due_date date'),
);
changeTable('product_issue_request_details', (text) => text.replace(/,\s*\n\);$/, '\n);'));
for (const table of ['users', 'materials', 'products'])
  changeTable(table, (text) =>
    text.replace(
      /\n\);$/,
      ',\n    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP\n);',
    ),
  );
for (const table of ['material_transactions', 'product_transactions'])
  changeTable(table, (text) => text.replace(/\n\);$/, ',\n    business_date date NOT NULL\n);'));
sql = sql.replaceAll('numeric(14,4)', 'numeric(16,6)');
sql = sql.replace(
  'CHECK ((request_quantity >= material_requirement))',
  'CHECK ((request_quantity > (0)::numeric))',
);
sql = sql.replace(
  'CHECK ((requested_quantity >= requirement_quantity))',
  'CHECK ((requested_quantity > (0)::numeric))',
);
sql = sql.replace(
  'ADD CONSTRAINT bom_product_id_key UNIQUE (product_id);',
  'ADD CONSTRAINT bom_product_version_key UNIQUE (product_id, version_code);\n\nALTER TABLE ONLY bakery_mrp.bom\n    ADD CONSTRAINT bom_id_product_id_key UNIQUE (bom_id, product_id);',
);
const relationshipSql = `
-- Each production line pins one immutable BOM version of the SAME product.
ALTER TABLE ONLY bakery_mrp.production_order_details
    ADD CONSTRAINT production_order_details_bom_product_fkey
    FOREIGN KEY (bom_id, product_id) REFERENCES bakery_mrp.bom(bom_id, product_id);
CREATE INDEX idx_production_order_details_bom_id ON bakery_mrp.production_order_details(bom_id);
`;

function changeFunction(name, definition) {
  const pattern = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION bakery_mrp\\.${name}\\([\\s\\S]*?\\nALTER FUNCTION bakery_mrp\\.${name}[^;]+;`,
  );
  if (!pattern.test(sql)) throw new Error(`Missing function ${name}`);
  sql = sql.replace(pattern, () => definition.trim());
}
changeFunction(
  'guard_bom',
  `
CREATE FUNCTION bakery_mrp.guard_bom() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE selected_bom varchar; used boolean;
BEGIN
  selected_bom:=CASE WHEN TG_OP='DELETE' THEN OLD.bom_id ELSE NEW.bom_id END;
  IF TG_TABLE_NAME='bom' THEN
    IF TG_OP='UPDATE' AND (NEW.bom_id,NEW.product_id) IS DISTINCT FROM (OLD.bom_id,OLD.product_id) THEN
      RAISE EXCEPTION 'Không đổi mã BOM hoặc sản phẩm của phiên bản BOM';
    END IF;
  ELSE
    SELECT bom_id INTO STRICT selected_bom FROM bom WHERE bom_id=selected_bom FOR UPDATE;
    IF TG_OP='UPDATE' AND (NEW.bom_id,NEW.bom_detail_id) IS DISTINCT FROM (OLD.bom_id,OLD.bom_detail_id) THEN
      RAISE EXCEPTION 'Không chuyển chi tiết sang phiên bản BOM khác';
    END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM production_order_details WHERE bom_id=selected_bom) INTO used;
  IF used THEN
    IF TG_TABLE_NAME='bom' AND TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
        RAISE EXCEPTION 'BOM đã được sử dụng: giữ nguyên phiên bản, hãy tạo phiên bản mới';
      END IF;
    ELSE
      RAISE EXCEPTION 'Không sửa/xóa định mức của phiên bản BOM đã được sử dụng';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
`,
);
changeFunction(
  'handle_production',
  `
CREATE FUNCTION bakery_mrp.handle_production() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE item record;
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM material_issue_requests WHERE production_id=NEW.production_order_id AND status='approved') THEN
    RAISE EXCEPTION 'Đã xuất NVL: phải xử lý hoàn trả trước khi hủy';
  END IF;
  IF NEW.status='in_progress' THEN
    IF NOT EXISTS(SELECT 1 FROM production_order_details WHERE production_order_id=NEW.production_order_id) THEN
      RAISE EXCEPTION 'Lệnh sản xuất chưa có chi tiết';
    END IF;
    -- An inactive historical version remains valid for the order that selected it.
    IF EXISTS(SELECT 1 FROM production_order_details d WHERE d.production_order_id=NEW.production_order_id
      AND NOT EXISTS(SELECT 1 FROM bom_details b WHERE b.bom_id=d.bom_id)) THEN
      RAISE EXCEPTION 'Phiên bản BOM của lệnh chưa có chi tiết';
    END IF;
    IF EXISTS(
      SELECT 1 FROM (
        SELECT b.material_id,sum(d.target_quantity*b.quantity) need
        FROM production_order_details d JOIN bom_details b ON b.bom_id=d.bom_id
        WHERE d.production_order_id=NEW.production_order_id GROUP BY b.material_id
      ) required LEFT JOIN (
        SELECT d.material_id,sum(d.request_quantity) issued
        FROM material_issue_requests h JOIN material_issue_request_details d USING(material_issue_request_id)
        WHERE h.production_id=NEW.production_order_id AND h.status='approved' GROUP BY d.material_id
      ) actual USING(material_id) WHERE coalesce(actual.issued,0)<required.need
    ) THEN RAISE EXCEPTION 'Chưa xuất đủ NVL theo phiên bản BOM của lệnh'; END IF;
  ELSIF NEW.status='completed' THEN
    IF NOT EXISTS(SELECT 1 FROM production_order_details WHERE production_order_id=NEW.production_order_id AND completed_quantity>0) THEN
      RAISE EXCEPTION 'Chưa có số lượng thành phẩm thực tế';
    END IF;
    FOR item IN SELECT * FROM production_order_details WHERE production_order_id=NEW.production_order_id AND completed_quantity>0 ORDER BY product_id LOOP
      PERFORM move_product(item.product_id,item.completed_quantity,NEW.production_order_id,'production_orders');
    END LOOP;
    NEW.completion_date:=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
`,
);
changeFunction(
  'post_material_issue',
  `
CREATE FUNCTION bakery_mrp.post_material_issue() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE state text; item record;
BEGIN
  IF NEW.status<>'approved' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT status INTO STRICT state FROM production_orders WHERE production_order_id=NEW.production_id FOR UPDATE;
  IF state<>'pending' THEN RAISE EXCEPTION 'Chỉ xuất NVL cho lệnh chưa bắt đầu'; END IF;
  IF NOT EXISTS(SELECT 1 FROM material_issue_request_details WHERE material_issue_request_id=NEW.material_issue_request_id) THEN
    RAISE EXCEPTION 'Yêu cầu xuất chưa có chi tiết';
  END IF;
  -- Backend enforces issue count, full BOM material set/quantities and ownership.
  -- This existing trigger only posts stock after a valid status transition.
  FOR item IN SELECT * FROM material_issue_request_details WHERE material_issue_request_id=NEW.material_issue_request_id ORDER BY material_id LOOP
    PERFORM move_material(item.material_id,-item.request_quantity,NEW.material_issue_request_id,'material_issue_requests');
  END LOOP;
  RETURN NEW;
END $$;
`,
);
changeFunction(
  'post_receipt',
  `
CREATE FUNCTION bakery_mrp.post_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE state text; item record;
BEGIN
  IF NEW.status<>'completed' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
  SELECT status INTO STRICT state FROM material_replenishment_requests
  WHERE material_replenishment_request_id=NEW.material_replenishment_request_id FOR UPDATE;
  IF state<>'approved' THEN RAISE EXCEPTION 'Yêu cầu bổ sung chưa được duyệt'; END IF;
  IF NOT EXISTS(SELECT 1 FROM material_replenishment_request_details WHERE material_replenishment_request_id=NEW.material_replenishment_request_id) THEN
    RAISE EXCEPTION 'Yêu cầu bổ sung chưa có chi tiết';
  END IF;
  IF EXISTS(SELECT 1 FROM
    (SELECT material_id FROM material_replenishment_request_details WHERE material_replenishment_request_id=NEW.material_replenishment_request_id) requested
    FULL JOIN (SELECT material_id FROM material_receipt_note_details WHERE material_receipt_note_id=NEW.material_receipt_note_id) received USING(material_id)
    WHERE requested.material_id IS NULL OR received.material_id IS NULL
  ) THEN RAISE EXCEPTION 'Nguyên liệu nhập phải khớp phiếu bổ sung'; END IF;
  -- Quantity may differ from requested. Backend validates the current minimum under row locks.
  FOR item IN SELECT * FROM material_receipt_note_details WHERE material_receipt_note_id=NEW.material_receipt_note_id ORDER BY material_id LOOP
    PERFORM move_material(item.material_id,item.received_quantity,NEW.material_receipt_note_id,'material_receipt_notes');
  END LOOP;
  UPDATE material_replenishment_requests SET status='fulfilled' WHERE material_replenishment_request_id=NEW.material_replenishment_request_id;
  RETURN NEW;
END $$;
`,
);
changeFunction(
  'move_material',
  `
CREATE FUNCTION bakery_mrp.move_material(p_material varchar,p_delta numeric,p_record varchar,p_name text) RETURNS void
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE balance numeric; delta numeric:=round(p_delta,6); day date:=(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  SELECT stock_quantity INTO STRICT balance FROM materials WHERE material_id=p_material FOR UPDATE;
  IF delta IS NULL OR delta=0 OR balance+delta<0 THEN RAISE EXCEPTION 'Nguyên liệu %: tồn kho không đủ hoặc lượng thay đổi không hợp lệ',p_material; END IF;
  IF p_name='material_receipt_notes' THEN SELECT receipt_date INTO STRICT day FROM material_receipt_notes WHERE material_receipt_note_id=p_record; END IF;
  UPDATE materials SET stock_quantity=balance+delta WHERE material_id=p_material;
  INSERT INTO material_transactions(material_transaction_id,material_id,quantity_change,balance_before,balance_after,transaction_type,created_at,record_id,record_name,business_date)
  VALUES('MT'||nextval('transaction_number'),p_material,delta,balance,balance+delta,CASE WHEN delta>0 THEN 'receipt' ELSE 'issue' END,clock_timestamp(),p_record,p_name,day);
END $$;
`,
);
changeFunction(
  'move_product',
  `
CREATE FUNCTION bakery_mrp.move_product(p_product varchar,p_delta integer,p_record varchar,p_name text) RETURNS void
LANGUAGE plpgsql SET search_path=bakery_mrp,pg_temp AS $$
DECLARE balance integer;
BEGIN
  SELECT stock_quantity INTO STRICT balance FROM products WHERE product_id=p_product FOR UPDATE;
  IF p_delta IS NULL OR p_delta=0 OR balance+p_delta<0 THEN RAISE EXCEPTION 'Thành phẩm %: tồn kho không đủ hoặc lượng thay đổi không hợp lệ',p_product; END IF;
  UPDATE products SET stock_quantity=balance+p_delta WHERE product_id=p_product;
  INSERT INTO product_transactions(product_transaction_id,product_id,quantity_change,balance_before,balance_after,transaction_type,created_at,record_id,record_name,business_date)
  VALUES('PT'||nextval('transaction_number'),p_product,p_delta,balance,balance+p_delta,CASE WHEN p_delta>0 THEN 'receipt' ELSE 'issue' END,clock_timestamp(),p_record,p_name,(clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
END $$;
`,
);
sql = sql.replace(
  "NEW.status IN ('approved', 'rejected', 'completed')",
  "NEW.status IN ('approved', 'rejected')",
);
// Remove stale pg_dump ownership/TOC metadata; this is a standalone definition, not a migration.
sql = sql
  .replace(/^\\(?:un)?restrict[^\n]*\n/gm, '')
  .replace(/^ALTER (?:SCHEMA|TABLE|FUNCTION|SEQUENCE)[^\n]+ OWNER TO postgres;\n/gm, '');
sql = sql
  .split('\n')
  .filter((line) => !line.startsWith('--'))
  .join('\n');
const quote = (value) => (value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`);
// COPY markers were comments and removed above. Put the normalized seed back before constraints.
const firstConstraint = sql.indexOf('ALTER TABLE ONLY');
if (firstConstraint < 0) throw new Error('Missing constraint section');
const seedSql = [...data]
  .map(([table, section]) =>
    section.rows.length
      ? `INSERT INTO bakery_mrp.${table} (${section.columns.join(', ')}) VALUES\n${section.rows.map((row) => `    (${section.columns.map((column) => quote(row[column])).join(', ')})`).join(',\n')};`
      : `-- ${table}: no source seed rows.`,
  )
  .join('\n\n');
// Sequence setval remains valid regardless of placement relative to seed; seed does not call nextval.
sql = sql.slice(0, firstConstraint) + '\n' + seedSql + '\n\n' + sql.slice(firstConstraint);
const eventSql = `
CREATE TABLE bakery_mrp.business_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    object_type text NOT NULL CHECK (object_type IN ('production_orders','material_replenishment_requests','material_receipt_notes','material_issue_requests','product_issue_requests')),
    object_id varchar(20) NOT NULL,
    action text NOT NULL CHECK (btrim(action)<>''),
    from_status text,
    to_status text,
    actor_user_id varchar(20) NOT NULL REFERENCES bakery_mrp.users(user_id),
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX business_events_object_idx ON bakery_mrp.business_events(object_type,object_id,event_id);
CREATE INDEX business_events_actor_idx ON bakery_mrp.business_events(actor_user_id,occurred_at);
COMMENT ON TABLE bakery_mrp.business_events IS 'Backend ghi timeline cùng transaction; không tự tạo sự kiện lịch sử hoặc trigger mới';
COMMENT ON COLUMN bakery_mrp.bom.version_code IS 'Phiên bản bất biến khi đã được lệnh tham chiếu; tạo phiên bản mới để thay định mức';
COMMENT ON COLUMN bakery_mrp.bom.is_active IS 'Chỉ chọn mặc định cho lệnh mới; ngừng hoạt động không thay BOM đã gắn trên lệnh cũ';
COMMENT ON COLUMN bakery_mrp.production_order_details.bom_id IS 'BOM version của dòng lệnh; dữ liệu nguồn được gắn theo BOM duy nhất của sản phẩm tại lúc chuyển đổi, không khẳng định lịch sử phiên bản đã mất';
COMMENT ON COLUMN bakery_mrp.material_receipt_notes.receipt_date IS 'Ngày nhập hàng; Backend kiểm ngày tương lai và khóa khi pending';
COMMENT ON COLUMN bakery_mrp.material_transactions.business_date IS 'Ngày nghiệp vụ dùng báo cáo; balance_before/after theo thứ tự ghi sổ';
COMMENT ON COLUMN bakery_mrp.product_transactions.business_date IS 'Ngày nghiệp vụ tại Việt Nam; balance_before/after theo thứ tự ghi sổ';
COMMENT ON TABLE bakery_mrp.material_issue_requests IS 'Quy tắc số lần xuất và đủ toàn bộ BOM do Backend kiểm tra, không có unique index/trigger cho quy tắc một lần';
`;
const header = `-- Bloom Bakery MRP - OFFICIAL standalone SQL for a NEW empty database.
-- Target: PostgreSQL 18. Source SHA-256: ${sourceHash}
-- Versioned BOM: each order line stores bom_id; at most one active BOM per product.
-- No snapshot/requirements/migration tables. No new triggers.
-- Backend owns issue-count/BOM-quantity validation, authorization, timeline and notifications.
-- Existing stock-posting triggers remain: API must NOT post the same stock movement twice.
-- Historical source rows are retained; unknown review/creation timestamps remain NULL.
-- PostgreSQL runtime verification is recorded separately in docs/database-official-test-results.json.
BEGIN;
`;
sql = (
  header +
  sql +
  '\n' +
  relationshipSql +
  eventSql +
  '\nSET check_function_bodies = true;\nCOMMIT;\n'
).replace(/\n{3,}/g, '\n\n');

// Static structural/data checks only. This script never connects to a database.
const tableDefs = new Map(
  [...sql.matchAll(/CREATE TABLE bakery_mrp\.(\w+) \(([\s\S]*?)\n\);/g)].map((m) => [m[1], m[2]]),
);
if (tableDefs.size !== 25)
  throw new Error('Expected exactly 24 source tables plus business_events');
for (const forbidden of [
  'schema_migrations',
  'schema_migration',
  'production_bom_snapshot',
  'production_material_requirements',
])
  if (tableDefs.has(forbidden)) throw new Error(`Unexpected table ${forbidden}`);
if (
  /material_issue_one_active_per_order|enforce_single_material_issue|CREATE UNIQUE INDEX[^;]+material_issue_requests/s.test(
    sql,
  )
)
  throw new Error('Issue-count rule must remain in Backend');
if (/CREATE TABLE[^;]+,\s*\)/s.test(sql)) throw new Error('Trailing comma in a table definition');
if (/COPY .*FROM stdin|^\\/m.test(sql))
  throw new Error('Expected portable SQL without psql COPY/meta commands');
for (const [table, section] of data) {
  const definition = tableDefs.get(table);
  if (!definition) throw new Error(`Missing table definition ${table}`);
  for (const column of section.columns)
    if (!new RegExp(`^\\s+${column}\\s`, 'm').test(definition))
      throw new Error(`Unknown seed column ${table}.${column}`);
}
let foreignKeyCount = 0;
for (const match of sql.matchAll(
  /ALTER TABLE ONLY bakery_mrp\.(\w+)\s+ADD CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\) REFERENCES bakery_mrp\.(\w+)\(([^)]+)\)/g,
)) {
  const [, child, name, childNames, parent, parentNames] = match;
  const children = childNames.split(',').map((v) => v.trim()),
    parents = parentNames.split(',').map((v) => v.trim());
  const allowed = new Set(
    rows(parent).map((row) => JSON.stringify(parents.map((key) => row[key]))),
  );
  for (const row of rows(child))
    if (
      children.every((key) => row[key] !== null) &&
      !allowed.has(JSON.stringify(children.map((key) => row[key])))
    )
      throw new Error(`Seed foreign key violation ${name}`);
  foreignKeyCount++;
}
for (const match of sql.matchAll(
  /ALTER TABLE ONLY bakery_mrp\.(\w+)\s+ADD CONSTRAINT (\w+) (?:PRIMARY KEY|UNIQUE) \(([^)]+)\)/g,
)) {
  const keys = match[3].split(',').map((v) => v.trim()),
    seen = new Set();
  for (const row of rows(match[1])) {
    if (keys.some((key) => row[key] === null)) continue;
    const value = JSON.stringify(keys.map((key) => row[key]));
    if (seen.has(value)) throw new Error(`Seed unique violation ${match[2]}`);
    seen.add(value);
  }
}
for (const bom of rows('bom')) {
  if (
    rows('bom').filter((other) => other.product_id === bom.product_id && other.is_active === 't')
      .length > 1
  )
    throw new Error('Multiple active BOMs in seed');
  if (
    rows('products').find((product) => product.product_id === bom.product_id)?.unit_id !==
    bom.unit_id
  )
    throw new Error('Seed BOM/product unit mismatch');
}
const triggers = [...sql.matchAll(/^CREATE TRIGGER (\w+) .*? ON bakery_mrp\.(\w+)/gm)].map(
  (m) => `${m[2]}.${m[1]}`,
);
const functions = [...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION bakery_mrp\.(\w+)/gm)].map(
  (m) => m[1],
);
if (JSON.stringify([...triggers].sort()) !== JSON.stringify([...originalTriggers].sort()))
  throw new Error('Existing trigger set changed');
if (JSON.stringify([...functions].sort()) !== JSON.stringify([...originalFunctions].sort()))
  throw new Error('Unexpected new/missing SQL functions');
if (/JOIN bom [^\n]*USING\(product_id\)/.test(sql))
  throw new Error('Ambiguous BOM lookup by product only');
const output = resolve('database/bakery_mrp_official.sql');
if (resolve(source) === output) throw new Error('Never overwrite source');
mkdirSync('database', { recursive: true });
mkdirSync('docs', { recursive: true });
writeFileSync(output, sql, 'utf8');
const summary = {
  sourceSha256: sourceHash,
  officialSqlSha256: createHash('sha256').update(sql).digest('hex'),
  method: 'Static structure and in-memory seed validation only; no PostgreSQL execution',
  tableCount: tableDefs.size,
  triggerCount: triggers.length,
  functionCount: functions.length,
  addedTriggers: [],
  foreignKeysCheckedAgainstSeed: foreignKeyCount,
  seedRowCounts: Object.fromEntries(
    [...data].map(([table, section]) => [table, section.rows.length]),
  ),
  historicalBomAssignments: inferredBomAssignments,
  issueCountRule: 'Backend only; no partial unique index or count trigger',
  result: 'static checks passed',
};
writeFileSync(
  resolve('docs/database-official-static-review.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    output,
    tableCount: summary.tableCount,
    triggerCount: summary.triggerCount,
    functionCount: summary.functionCount,
    result: summary.result,
  }),
);
