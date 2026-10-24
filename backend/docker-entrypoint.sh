#!/bin/sh
set -e

echo "[backend] waiting for PostgreSQL..."
until node -e 'const { Client } = require("pg"); const c = new Client(); c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));' >/dev/null 2>&1; do
  sleep 1
done

echo "[backend] applying schema patch and seeding passwords..."
node --experimental-strip-types backend/src/bootstrap.ts

echo "[backend] starting API server..."
exec node --experimental-strip-types backend/src/server.ts
