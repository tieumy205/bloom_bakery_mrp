import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { pool, transaction } from './core/db.ts';
import { send, readBody } from './core/http.ts';
import { HttpError, translateError } from './core/errors.ts';
import { login, me, logout } from './modules/auth/routes.ts';
import { authenticate } from './modules/auth/session.ts';
import { snapshot } from './modules/data/snapshot.ts';
import { permissionMatrix, savePermissions } from './modules/users/service.ts';
import { executeCommand } from './modules/commands.ts';
import { report } from './modules/reports/service.ts';
import { list } from './modules/data/lists.ts';
export const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url || '/', 'http://local').pathname;
    if (req.method === 'GET' && path === '/api/health') {
      await pool.query('SELECT 1');
      return send(res, 200, { status: 'ok', database: 'connected' });
    }
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      const origin = req.headers.origin;
      const permitted = (process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173').split(',');
      if (req.headers['x-bloom-request'] !== '1' || (origin && !permitted.includes(origin)))
        throw new HttpError(403, 'Nguồn yêu cầu không hợp lệ.');
    }
    if (req.method === 'POST' && path === '/api/auth/login') return await login(req, res);
    if (req.method === 'GET' && path === '/api/auth/me') return await me(req, res);
    if (req.method === 'POST' && path === '/api/auth/logout') return await logout(req, res);
    if (req.method === 'GET' && path === '/api/snapshot')
      return send(
        res,
        200,
        await transaction(async (db) => snapshot(db, await authenticate(db, req)), true),
      );
    if (req.method === 'GET' && path === '/api/reports')
      return send(
        res,
        200,
        await transaction(
          async (db) =>
            report(db, await authenticate(db, req), new URL(req.url!, 'http://local').searchParams),
          true,
        ),
      );
    if (req.method === 'GET' && path.startsWith('/api/lists/'))
      return send(
        res,
        200,
        await transaction(
          async (db) =>
            list(
              db,
              await authenticate(db, req),
              path.slice('/api/lists/'.length),
              new URL(req.url!, 'http://local').searchParams,
            ),
          true,
        ),
      );
    if (req.method === 'GET' && path === '/api/permissions')
      return send(
        res,
        200,
        await transaction(async (db) => permissionMatrix(db, await authenticate(db, req)), true),
      );
    if (req.method === 'POST' && path === '/api/permissions') {
      const value = await readBody(req);
      await transaction(async (db) =>
        savePermissions(
          db,
          await authenticate(db, req),
          value as Parameters<typeof savePermissions>[2],
        ),
      );
      return send(res, 204);
    }
    if (req.method === 'POST' && path === '/api/commands') {
      const value = await readBody(req);
      const key = String(req.headers['idempotency-key'] || '');
      await transaction(async (db) => executeCommand(db, await authenticate(db, req), value, key));
      return send(res, 204);
    }
    throw new HttpError(404, 'API không tồn tại.');
  } catch (error) {
    const result = translateError(error);
    send(res, result.status, { message: result.message, code: result.code });
  }
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(Number(process.env.API_PORT || 3001), process.env.API_HOST || '127.0.0.1', () =>
    console.log('Bloom Backend ready'),
  );
  const close = () => server.close(() => void pool.end());
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}
