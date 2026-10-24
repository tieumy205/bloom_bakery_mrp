import { id, one, nextCode } from '../../core/db.ts';
import type { Db } from '../../core/db.ts';
import { ensure } from '../../core/errors.ts';
import { text, quantity, lines } from '../../core/validation.ts';
import { requirePermission } from '../auth/session.ts';
import type { Actor } from '../auth/session.ts';
import type { Material, Product, Bom } from '../../../../src/shared/domain/types.ts';
async function unitId(db: Db, value: string) {
  const name = text(value, 'Đơn vị', 20);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`unit:${name.toLowerCase()}`]);
  const found = await one<{ unit_id: string }>(
    db,
    'SELECT unit_id FROM units WHERE lower(symbol)=lower($1) OR lower(unit_name)=lower($1)',
    [name],
  );
  if (found) return found.unit_id;
  const key = id('UN');
  await db.query('INSERT INTO units(unit_id,unit_name,symbol) VALUES($1,$2,$2)', [key, name]);
  return key;
}
export async function saveCatalog(
  db: Db,
  actor: Actor,
  kind: 'materials' | 'products',
  value: Material | Product,
) {
  requirePermission(actor, kind, value.id ? 'update' : 'create');
  const name = text(value.name, 'Tên'),
    unit = await unitId(db, value.unit);
  const key = kind === 'materials' ? 'material_id' : 'product_id';
  const old = value.id
    ? await one<Record<string, any>>(db, `SELECT * FROM ${kind} WHERE ${key}=$1 FOR UPDATE`, [
        value.id,
      ])
    : undefined;
  ensure(!value.id || old, 'Danh mục không tồn tại.', 404);
  if (old && old.unit_id !== unit) {
    const reference =
      kind === 'materials'
        ? `SELECT 1 FROM bom_details WHERE material_id=$1 UNION ALL SELECT 1 FROM material_transactions WHERE material_id=$1 UNION ALL SELECT 1 FROM material_replenishment_request_details WHERE material_id=$1 UNION ALL SELECT 1 FROM material_receipt_note_details WHERE material_id=$1 UNION ALL SELECT 1 FROM material_issue_request_details WHERE material_id=$1`
        : `SELECT 1 FROM bom WHERE product_id=$1 UNION ALL SELECT 1 FROM production_order_details WHERE product_id=$1 UNION ALL SELECT 1 FROM product_transactions WHERE product_id=$1 UNION ALL SELECT 1 FROM product_issue_request_details WHERE product_id=$1`;
    ensure(
      Number(old.stock_quantity) === 0 && !(await db.query(reference, [value.id])).rowCount,
      'Không đổi đơn vị danh mục đã có tồn hoặc được sử dụng.',
    );
  }
  const itemId = value.id || (await nextCode(db, kind === 'materials' ? 'M' : 'B'));
  if (kind === 'materials') {
    const min = quantity((value as Material).minStock, 'Tồn tối thiểu', true);
    if (old)
      await db.query(
        'UPDATE materials SET material_name=$2,min_stock=$3,unit_id=$4 WHERE material_id=$1',
        [itemId, name, min, unit],
      );
    else
      await db.query(
        'INSERT INTO materials(material_id,material_name,min_stock,unit_id) VALUES($1,$2,$3,$4)',
        [itemId, name, min, unit],
      );
  } else {
    const image = (value as Product).image;
    ensure(
      typeof image === 'string' &&
        image.length <= 2100000 &&
        (!image || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)),
      'Ảnh cần là PNG/JPEG/WebP dưới 1,5 MB.',
    );
    if (old)
      await db.query(
        'UPDATE products SET product_name=$2,image_url=$3,unit_id=$4 WHERE product_id=$1',
        [itemId, name, image || null, unit],
      );
    else
      await db.query(
        'INSERT INTO products(product_id,product_name,image_url,unit_id) VALUES($1,$2,$3,$4)',
        [itemId, name, image || null, unit],
      );
  }
  return itemId;
}
export async function saveBom(db: Db, actor: Actor, value: Bom) {
  requirePermission(actor, 'boms', value.id ? 'update' : 'create');
  const product = text(value.productId, 'Thành phẩm', 20),
    version = text(value.version, 'Phiên bản', 20);
  ensure(typeof value.active === 'boolean', 'Chọn trạng thái BOM.');
  const p = await one<{ unit_id: string }>(
    db,
    'SELECT unit_id FROM products WHERE product_id=$1 FOR UPDATE',
    [product],
  );
  ensure(p, 'Thành phẩm không tồn tại.');
  const old = value.id
    ? await one<Record<string, any>>(db, 'SELECT * FROM bom WHERE bom_id=$1 FOR UPDATE', [value.id])
    : undefined;
  ensure(!value.id || old, 'BOM không tồn tại.', 404);
  if (old) {
    ensure(old.product_id === product, 'Không đổi sản phẩm của phiên bản BOM.');
    ensure(
      !(await db.query('SELECT 1 FROM production_order_details WHERE bom_id=$1', [value.id]))
        .rowCount,
      'BOM đã được sử dụng: tạo phiên bản mới để đổi định mức.',
    );
  }
  lines(value.lines, (line) => line.materialId);
  const normalized = value.lines.map((line) => ({
    materialId: line.materialId,
    quantity: quantity(line.quantity, 'Định mức'),
  }));
  ensure(
    !(
      await db.query(
        'SELECT 1 FROM bom WHERE product_id=$1 AND version_code=$2 AND bom_id<>$3',
        [product, version, value.id || ''],
      )
    ).rowCount,
    'không được nhập trùng tên phiên bản trước đó',
  );
  const signature = (list: { materialId: string; quantity: number }[]) =>
    list.map((line) => `${line.materialId}:${line.quantity}`).sort().join('|');
  const existingVersions = await db.query(
    'SELECT bom_id FROM bom WHERE product_id=$1 AND bom_id<>$2',
    [product, value.id || ''],
  );
  for (const row of existingVersions.rows) {
    const details = await db.query(
      'SELECT material_id,quantity FROM bom_details WHERE bom_id=$1',
      [row.bom_id],
    );
    if (
      signature(
        details.rows.map((line) => ({
          materialId: line.material_id,
          quantity: Number(line.quantity),
        })),
      ) === signature(normalized)
    )
      ensure(false, 'không được tạo 1 phiên bản mới trùng với phiên bản đã có');
  }
  const key = value.id || (await nextCode(db, 'BOM'));
  if (value.active)
    await db.query(
      'UPDATE bom SET is_active=false WHERE product_id=$1 AND bom_id<>$2 AND is_active',
      [product, key],
    );
  if (old) {
    await db.query('UPDATE bom SET version_code=$2,is_active=$3 WHERE bom_id=$1', [
      key,
      version,
      value.active,
    ]);
    await db.query('DELETE FROM bom_details WHERE bom_id=$1', [key]);
  } else
    await db.query(
      'INSERT INTO bom(bom_id,product_id,version_code,is_active,unit_id,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [key, product, version, value.active, p.unit_id, actor.id],
    );
  for (const line of normalized)
    await db.query(
      'INSERT INTO bom_details(bom_detail_id,bom_id,material_id,quantity) VALUES($1,$2,$3,$4)',
      [id('BD'), key, line.materialId, line.quantity],
    );
  return key;
}
export async function activateBom(db: Db, actor: Actor, value: { id: string; active: boolean }) {
  requirePermission(actor, 'boms', 'update');
  ensure(typeof value.active === 'boolean', 'Trạng thái không hợp lệ.');
  const b = await one<{ product_id: string }>(db, 'SELECT product_id FROM bom WHERE bom_id=$1', [
    value.id,
  ]);
  ensure(b, 'BOM không tồn tại.', 404);
  await db.query('SELECT 1 FROM products WHERE product_id=$1 FOR UPDATE', [b.product_id]);
  if (value.active)
    await db.query(
      'UPDATE bom SET is_active=false WHERE product_id=$1 AND bom_id<>$2 AND is_active',
      [b.product_id, value.id],
    );
  await db.query('UPDATE bom SET is_active=$2 WHERE bom_id=$1', [value.id, value.active]);
}
export async function deleteCatalog(
  db: Db,
  actor: Actor,
  value: { kind: 'materials' | 'products' | 'boms'; id: string },
) {
  ensure(['materials', 'products', 'boms'].includes(value.kind), 'Danh mục không hợp lệ.');
  requirePermission(actor, value.kind, 'delete');
  if (value.kind === 'boms') {
    const bom = await one<{ product_id: string }>(
      db,
      'SELECT product_id FROM bom WHERE bom_id=$1',
      [value.id],
    );
    ensure(bom, 'BOM không tồn tại.', 404);
    await db.query('SELECT 1 FROM products WHERE product_id=$1 FOR UPDATE', [bom.product_id]);
    await db.query('DELETE FROM bom_details WHERE bom_id=$1', [value.id]);
    await db.query('DELETE FROM bom WHERE bom_id=$1', [value.id]);
  } else {
    const key = value.kind === 'materials' ? 'material_id' : 'product_id';
    const item = await one<{ stock_quantity: string }>(
      db,
      `SELECT stock_quantity FROM ${value.kind} WHERE ${key}=$1 FOR UPDATE`,
      [value.id],
    );
    ensure(item, 'Danh mục không tồn tại.', 404);
    ensure(Number(item.stock_quantity) === 0, 'Không xóa danh mục còn tồn kho.');
    await db.query(`DELETE FROM ${value.kind} WHERE ${key}=$1`, [value.id]);
  }
}
