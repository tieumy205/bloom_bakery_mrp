import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pool, transaction } from './core/db.ts';
import { hashPassword } from './modules/auth/password.ts';
try {
  await pool.query(readFileSync('backend/database/001_auth_permissions.sql', 'utf8'));
  let initialized = 0;
  await transaction(async (db) => {
    const users = await db.query(
      'SELECT user_id FROM users WHERE user_id=ANY($1) AND password_hash IS NULL FOR UPDATE',
      [['U01', 'U02', 'U03']],
    );
    for (const user of users.rows) {
      await db.query(
        'UPDATE users SET password_hash=$2 WHERE user_id=$1 AND password_hash IS NULL',
        [user.user_id, await hashPassword('12345')],
      );
      initialized++;
    }
  });
  const path = 'backend/.env.local';
  if (existsSync(path) && !/^SESSION_SECRET=.+/m.test(readFileSync(path, 'utf8')))
    writeFileSync(
      path,
      readFileSync(path, 'utf8') + `\nSESSION_SECRET=${randomBytes(48).toString('hex')}\n`,
    );
  console.log(
    `Backend schema ready. Initialized ${initialized} existing accounts; previously set passwords preserved.`,
  );
} finally {
  await pool.end();
}
