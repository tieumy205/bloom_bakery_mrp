import type { Db } from '../../core/db.ts';
import { id } from '../../core/db.ts';
import type { Actor } from '../auth/session.ts';
export async function event(
  db: Db,
  actor: Actor,
  type: string,
  key: string,
  action: string,
  from: string | null,
  to: string | null,
  details: Record<string, unknown> = {},
) {
  await db.query(
    'INSERT INTO business_events(object_type,object_id,action,from_status,to_status,actor_user_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [type, key, action, from, to, actor.id, JSON.stringify(details)],
  );
}
export async function notify(db: Db, userId: string, type: string, key: string, message: string) {
  await db.query(
    'INSERT INTO notifications(notification_id,user_id,message,record_id,object_type) VALUES($1,$2,$3,$4,$5)',
    [id('N'), userId, message, key, type],
  );
}
export async function notifyManagers(
  db: Db,
  type: string,
  key: string,
  message: string,
  module = type,
  action = 'approve',
) {
  const users = await db.query(
    "SELECT u.user_id FROM users u JOIN roles r USING(role_id) WHERE u.is_active AND r.name='manager' AND has_permission(u.user_id,$1,$2)",
    [module, action],
  );
  for (const user of users.rows) await notify(db, user.user_id, type, key, message);
}
