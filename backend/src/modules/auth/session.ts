import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from '../../core/db.ts';
import { HttpError, ensure } from '../../core/errors.ts';
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  active: boolean;
  createdAt: string;
  flags: Record<string, boolean>;
};
export const moduleMap: Record<string, string> = {
  boms: 'bom',
  orders: 'production_orders',
  requests: 'material_replenishment_requests',
  receipts: 'material_receipt_notes',
  'material-issues': 'material_issue_requests',
  'product-issues': 'product_issue_requests',
  reports: 'statistics',
  permissions: 'access_control',
};
const apiModule = (code: string) =>
  Object.keys(moduleMap).find((key) => moduleMap[key] === code) || code;
function sign(text: string) {
  const secret = process.env.SESSION_SECRET;
  ensure(secret && secret.length >= 32, 'Cấu hình phiên đăng nhập chưa sẵn sàng.', 503);
  return createHmac('sha256', secret).update(text).digest('base64url');
}
export function createToken(id: string, version: number) {
  const text = Buffer.from(
    JSON.stringify({
      id,
      v: version,
      exp: Date.now() + 8 * 60 * 60 * 1000,
      nonce: randomBytes(12).toString('hex'),
    }),
  ).toString('base64url');
  return `${text}.${sign(text)}`;
}
export function parseToken(token: string): { id: string; v: number; exp: number } | null {
  try {
    const [text, mac, ...extra] = token.split('.');
    if (!text || !mac || extra.length) return null;
    const expected = Buffer.from(sign(text)),
      actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const value = JSON.parse(Buffer.from(text, 'base64url').toString());
    return typeof value.id === 'string' &&
      Number.isInteger(value.v) &&
      typeof value.exp === 'number' &&
      value.exp > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}
export function cookie(req: IncomingMessage) {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('bloom_session='))
      ?.slice(14) || ''
  );
}
export function setCookie(res: ServerResponse, token: string) {
  res.setHeader(
    'Set-Cookie',
    `bloom_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 28800 : 0}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
  );
}
export async function actorById(db: Db, id: string, version?: number): Promise<Actor> {
  const result = await db.query(
    'SELECT u.*,r.name AS role FROM users u JOIN roles r USING(role_id) WHERE user_id=$1',
    [id],
  );
  const u = result.rows[0];
  if (!u || !u.is_active || (version !== undefined && u.auth_version !== version))
    throw new HttpError(401, 'Phiên đăng nhập không còn hợp lệ.', 'UNAUTHENTICATED');
  const permissions = await db.query(
    `SELECT m.code,p.action,has_permission($1,m.code,p.action) AS allowed FROM permissions p JOIN modules m USING(module_id)`,
    [id],
  );
  return {
    id: u.user_id,
    name: u.full_name,
    email: u.email || '',
    role: u.role,
    active: u.is_active,
    createdAt: u.created_at?.toISOString() || '',
    flags: Object.fromEntries(
      permissions.rows.map((p) => [`${apiModule(p.code)}.${p.action}`, p.allowed === true]),
    ),
  };
}
export async function authenticate(db: Db, req: IncomingMessage) {
  const token = parseToken(cookie(req));
  if (!token) throw new HttpError(401, 'Vui lòng đăng nhập.', 'UNAUTHENTICATED');
  return actorById(db, token.id, token.v);
}
export function allowed(actor: Actor, module: string, action = 'read') {
  return actor.flags[`${module}.${action}`] === true;
}
export function requirePermission(actor: Actor, module: string, action = 'read') {
  if (!allowed(actor, module, action))
    throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.', 'FORBIDDEN');
}
