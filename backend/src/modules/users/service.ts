import { id, one } from '../../core/db.ts';
import type { Db } from '../../core/db.ts';
import { ensure } from '../../core/errors.ts';
import { hashPassword } from '../auth/password.ts';
import { requirePermission, moduleMap } from '../auth/session.ts';
import type { Actor } from '../auth/session.ts';
import type { User } from '../../../../src/shared/domain/types.ts';
export async function saveUser(db: Db, actor: Actor, value: User) {
  requirePermission(actor, 'users', value.id ? 'update' : 'create');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('bloom_admin_access'))");
  ensure(
    typeof value.name === 'string' &&
      value.name.trim().length > 0 &&
      value.name.length <= 100 &&
      typeof value.email === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
      value.email.length <= 100 &&
      ['admin', 'manager', 'employee'].includes(value.role) &&
      typeof value.active === 'boolean',
    'Thông tin tài khoản không hợp lệ.',
  );
  const existing = value.id
    ? await one(db, 'SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [value.id])
    : undefined;
  ensure(!value.id || existing, 'Tài khoản không tồn tại.', 404);
  ensure(
    actor.id !== value.id || (value.active && value.role === 'admin'),
    'Không tự khóa hoặc gỡ Admin hiện tại.',
  );
  if (existing && (!value.active || value.role !== 'employee'))
    ensure(
      !(
        await db.query(
          "SELECT 1 FROM production_orders WHERE assigned_to=$1 AND status IN ('pending','in_progress')",
          [value.id],
        )
      ).rowCount,
      'Nhân viên còn lệnh chưa hoàn thành.',
    );
  const role = await one<{ role_id: string }>(db, 'SELECT role_id FROM roles WHERE name=$1', [
    value.role,
  ]);
  ensure(role, 'Vai trò không tồn tại.');
  const password = value.password;
  ensure(
    existing || (typeof password === 'string' && password.length >= 5),
    'Admin cần nhập mật khẩu có ít nhất 5 ký tự cho tài khoản mới.',
  );
  if (password !== undefined && password !== '')
    ensure(
      typeof password === 'string' && password.length >= 5 && password.length <= 128,
      'Mật khẩu cần từ 5 đến 128 ký tự.',
    );
  const hash = password ? await hashPassword(password) : undefined;
  const userId = value.id || id('U');
  if (existing)
    await db.query(
      'UPDATE users SET full_name=$2,email=$3,role_id=$4::varchar,is_active=$5::boolean,password_hash=coalesce($6::text,password_hash),auth_version=auth_version+CASE WHEN $6::text IS NOT NULL OR role_id<>$4::varchar OR is_active<>$5::boolean THEN 1 ELSE 0 END WHERE user_id=$1',
      [
        userId,
        value.name.trim(),
        value.email.trim().toLowerCase(),
        role.role_id,
        value.active,
        hash || null,
      ],
    );
  else
    await db.query(
      'INSERT INTO users(user_id,username,full_name,email,role_id,is_active,password_hash) VALUES($1,$1,$2,$3,$4,$5,$6)',
      [
        userId,
        value.name.trim(),
        value.email.trim().toLowerCase(),
        role.role_id,
        value.active,
        hash,
      ],
    );
  return userId;
}
export async function deleteUser(db: Db, actor: Actor, userId: string) {
  requirePermission(actor, 'users', 'delete');
  ensure(typeof userId === 'string' && userId !== actor.id, 'Không tự xóa tài khoản hiện tại.');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('bloom_admin_access'))");
  ensure(
    (await db.query('DELETE FROM users WHERE user_id=$1', [userId])).rowCount,
    'Tài khoản không tồn tại.',
    404,
  );
}
export async function permissionMatrix(db: Db, actor: Actor) {
  requirePermission(actor, 'permissions', 'read');
  const p = await db.query(
    'SELECT p.permission_id AS id,m.code AS module,p.action,p.description FROM permissions p JOIN modules m USING(module_id) ORDER BY m.code,p.action',
  );
  const apiName = (name: string) =>
    Object.keys(moduleMap).find((key) => moduleMap[key] === name) || name;
  const definitions = p.rows.map((row) => ({ ...row, module: apiName(row.module) }));
  const users = await db.query(
    'SELECT u.user_id AS id,u.full_name AS name,u.is_active AS active,r.name AS role FROM users u JOIN roles r USING(role_id) ORDER BY u.full_name',
  );
  const grants = await db.query(
    `SELECT u.user_id,p.permission_id,EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=u.role_id AND rp.permission_id=p.permission_id) AS ceiling,coalesce(up.is_allowed,true) AS flag FROM users u CROSS JOIN permissions p LEFT JOIN user_permissions up ON up.user_id=u.user_id AND up.permission_id=p.permission_id`,
  );
  return {
    permissions: definitions,
    users: users.rows.map((user) => {
      const values = grants.rows.filter((row) => row.user_id === user.id);
      return {
        ...user,
        flags: Object.fromEntries(
          values.map((row) => [row.permission_id, row.ceiling && row.flag]),
        ),
        ceiling: Object.fromEntries(values.map((row) => [row.permission_id, row.ceiling === true])),
      };
    }),
  };
}
export async function savePermissions(
  db: Db,
  actor: Actor,
  value: { userIds: string[]; flags: Record<string, boolean> },
) {
  requirePermission(actor, 'permissions', 'update');
  ensure(
    value && typeof value === 'object' && !Array.isArray(value),
    'Thông tin phân quyền không hợp lệ.',
  );
  ensure(
    Array.isArray(value.userIds) &&
      value.userIds.length > 0 &&
      value.userIds.length <= 100 &&
      new Set(value.userIds).size === value.userIds.length &&
      value.flags &&
      typeof value.flags === 'object' &&
      !Array.isArray(value.flags),
    'Chọn tài khoản và các cờ quyền hợp lệ.',
  );
  await db.query("SELECT pg_advisory_xact_lock(hashtext('bloom_admin_access'))");
  const all = await db.query(
    'SELECT p.permission_id,m.code,p.action FROM permissions p JOIN modules m USING(module_id)',
  );
  ensure(
    Object.entries(value.flags).every(
      ([key, flag]) => typeof flag === 'boolean' && all.rows.some((p) => p.permission_id === key),
    ),
    'Quyền hoặc cờ không hợp lệ.',
  );
  for (const userId of [...value.userIds].sort()) {
    const u = await one<{ role_id: string }>(
      db,
      'SELECT role_id FROM users WHERE user_id=$1 FOR UPDATE',
      [userId],
    );
    ensure(u, 'Tài khoản không tồn tại.', 404);
    const ceiling = await db.query('SELECT permission_id FROM role_permissions WHERE role_id=$1', [
      u.role_id,
    ]);
    const permitted = new Set(ceiling.rows.map((p) => p.permission_id));
    for (const p of all.rows) {
      const allow = value.flags[p.permission_id] === true;
      ensure(
        !allow || permitted.has(p.permission_id),
        'Quyền được chọn vượt phạm vi vai trò của tài khoản.',
      );
      if (
        userId === actor.id &&
        ['users', 'access_control'].includes(p.code) &&
        ['read', 'update'].includes(p.action)
      )
        ensure(allow, 'Không tự thu hồi quyền quản trị đang sử dụng.');
      await db.query(
        'INSERT INTO user_permissions(user_id,permission_id,is_allowed,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,permission_id) DO UPDATE SET is_allowed=excluded.is_allowed,updated_by=excluded.updated_by,updated_at=clock_timestamp()',
        [userId, p.permission_id, allow, actor.id],
      );
    }
  }
}
