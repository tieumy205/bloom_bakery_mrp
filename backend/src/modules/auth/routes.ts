import type { IncomingMessage, ServerResponse } from 'node:http';
import { transaction } from '../../core/db.ts';
import { ensure, HttpError } from '../../core/errors.ts';
import { readBody, send } from '../../core/http.ts';
import { actorById, authenticate, createToken, setCookie } from './session.ts';
import { verifyPassword, hashPassword } from './password.ts';
const attempts = new Map<string, { count: number; until: number }>();
const dummy = hashPassword('not-a-user-password');
export async function login(req: IncomingMessage, res: ServerResponse) {
  const body = (await readBody(req)) as { login?: unknown; password?: unknown };
  ensure(
    body && typeof body === 'object' && !Array.isArray(body),
    'Thông tin đăng nhập không hợp lệ.',
  );
  ensure(
    typeof body.login === 'string' &&
      body.login.trim().length > 0 &&
      body.login.length <= 100 &&
      typeof body.password === 'string' &&
      body.password.length > 0 &&
      body.password.length <= 200,
    'Vui lòng nhập tài khoản và mật khẩu hợp lệ.',
  );
  const key = `${req.socket.remoteAddress}:${body.login.trim().toLowerCase()}`;
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const prior = attempts.get(key);
  if (prior && prior.count >= 10 && prior.until > now)
    throw new HttpError(429, 'Đăng nhập sai nhiều lần. Vui lòng thử lại sau.');
  ensure(
    attempts.size < 5000 || attempts.has(key),
    'Có quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau.',
    429,
  );
  const result = await transaction(async (db) => {
    const users = await db.query(
      'SELECT user_id,password_hash,is_active,auth_version FROM users WHERE lower(username)=$1 OR lower(email)=$1',
      [String(body.login).trim().toLowerCase()],
    );
    const user = users.rows[0];
    const correct = await verifyPassword(
      String(body.password),
      user?.password_hash || (await dummy),
    );
    if (!user || !correct || !user.is_active) {
      attempts.set(key, { count: (prior?.count || 0) + 1, until: now + 15 * 60 * 1000 });
      throw new HttpError(
        401,
        user && !user.is_active ? 'Tài khoản không tồn tại' : 'Tài khoản hoặc mật khẩu không đúng.',
      );
    }
    attempts.delete(key);
    return {
      actor: await actorById(db, user.user_id),
      token: createToken(user.user_id, user.auth_version),
    };
  });
  setCookie(res, result.token);
  send(res, 200, result.actor);
}
export async function me(req: IncomingMessage, res: ServerResponse) {
  send(res, 200, await transaction((db) => authenticate(db, req), true));
}
export async function logout(req: IncomingMessage, res: ServerResponse) {
  await transaction(async (db) => {
    const actor = await authenticate(db, req);
    await db.query('UPDATE users SET auth_version=auth_version+1 WHERE user_id=$1', [actor.id]);
  });
  setCookie(res, '');
  send(res, 204);
}
