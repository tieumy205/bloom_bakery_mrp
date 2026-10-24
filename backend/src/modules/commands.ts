import { createHash } from 'node:crypto';
import type { Db } from '../core/db.ts';
import { ensure, HttpError } from '../core/errors.ts';
import { requirePermission } from './auth/session.ts';
import type { Actor } from './auth/session.ts';
import { saveUser, deleteUser } from './users/service.ts';
import type { User } from '../../../src/shared/domain/types.ts';
import { saveCatalog, saveBom, deleteCatalog, activateBom } from './catalog/service.ts';
import { saveOrder, orderAction } from './production/service.ts';
import {
  saveDocument,
  documentAction,
  deleteDocument,
  findDocument,
  readNotification,
} from './documents/service.ts';
export async function executeCommand(db: Db, actor: Actor, input: unknown, key: string) {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 'Command không hợp lệ.');
  const command = input as { type: string; payload: unknown };
  ensure(
    typeof command.type === 'string' && key.length > 0 && key.length <= 100,
    'Command hoặc mã chống gửi trùng không hợp lệ.',
  );
  let work: () => Promise<unknown>;
  if (command.type === 'save-user') {
    ensure(
      command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload),
      'Thông tin tài khoản không hợp lệ.',
    );
    const value = command.payload as User;
    requirePermission(actor, 'users', value.id ? 'update' : 'create');
    work = () => saveUser(db, actor, value);
  } else if (command.type === 'delete-user') {
    ensure(typeof command.payload === 'string', 'Mã tài khoản không hợp lệ.');
    requirePermission(actor, 'users', 'delete');
    const value = command.payload;
    work = () => deleteUser(db, actor, value);
  } else if (
    ['save-material', 'save-product', 'save-bom', 'set-bom-active', 'delete-catalog'].includes(
      command.type,
    )
  ) {
    ensure(
      command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload),
      'Dữ liệu danh mục không hợp lệ.',
    );
    const value = command.payload as any;
    const module =
      command.type === 'delete-catalog'
        ? value.kind
        : command.type === 'save-material'
          ? 'materials'
          : command.type === 'save-product'
            ? 'products'
            : 'boms';
    const action =
      command.type === 'delete-catalog'
        ? 'delete'
        : command.type === 'set-bom-active' || value.id
          ? 'update'
          : 'create';
    requirePermission(actor, module, action);
    work = () =>
      command.type === 'save-material'
        ? saveCatalog(db, actor, 'materials', value)
        : command.type === 'save-product'
          ? saveCatalog(db, actor, 'products', value)
          : command.type === 'save-bom'
            ? saveBom(db, actor, value)
            : command.type === 'set-bom-active'
              ? activateBom(db, actor, value)
              : deleteCatalog(db, actor, value);
  } else if (command.type === 'save-order' || command.type === 'order-action') {
    ensure(
      command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload),
      'Dữ liệu lệnh không hợp lệ.',
    );
    const value = command.payload as any;
    requirePermission(
      actor,
      'orders',
      command.type === 'save-order' ? (value.id ? 'update' : 'create') : value.action,
    );
    work = () =>
      command.type === 'save-order' ? saveOrder(db, actor, value) : orderAction(db, actor, value);
  } else if (command.type === 'save-document') {
    ensure(
      command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload),
      'Phiếu không hợp lệ.',
    );
    const value = command.payload as any;
    requirePermission(actor, value.kind, value.id ? 'update' : 'create');
    work = () => saveDocument(db, actor, value);
  } else if (command.type === 'document-action' || command.type === 'delete-document') {
    const value = command.payload as any;
    ensure(
      command.type === 'delete-document'
        ? typeof value === 'string'
        : value && typeof value === 'object',
      'Thao tác phiếu không hợp lệ.',
    );
    const key = command.type === 'delete-document' ? value : value.id;
    const found = await findDocument(db, key);
    requirePermission(
      actor,
      found.kind,
      command.type === 'delete-document'
        ? 'delete'
        : value.action === 'submit'
          ? 'update'
          : value.action,
    );
    work = () =>
      command.type === 'delete-document'
        ? deleteDocument(db, actor, key)
        : documentAction(db, actor, value);
  } else if (command.type === 'read-notification') {
    requirePermission(actor, 'notifications');
    ensure(typeof command.payload === 'string', 'Thông báo không hợp lệ.');
    const key = command.payload;
    work = () => readNotification(db, actor, key);
  } else throw new HttpError(422, 'Loại thao tác chưa được hỗ trợ.');
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const inserted = await db.query(
    'INSERT INTO api_request_keys(user_id,request_key,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_key',
    [actor.id, key, hash],
  );
  if (!inserted.rowCount) {
    const prior = await db.query(
      'SELECT request_hash FROM api_request_keys WHERE user_id=$1 AND request_key=$2',
      [actor.id, key],
    );
    ensure(
      prior.rows[0].request_hash === hash,
      'Mã gửi trùng đã được dùng với nội dung khác.',
      409,
    );
    return;
  }
  await work();
}
