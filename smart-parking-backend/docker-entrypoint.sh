#!/bin/sh
set -e

echo "[SmartParking] Checking database connection..."
# If AUTO_DB_PUSH is enabled (default true)
if [ "${AUTO_DB_PUSH:-true}" = "true" ]; then
    echo "[SmartParking] Synchronizing database schema with Prisma..."
    npx prisma db push --skip-generate || echo "[SmartParking] Warning: db push failed or skipped."
fi

if [ "${AUTO_DB_SEED:-true}" = "true" ]; then
    echo "[SmartParking] Ensuring base devices and spots are seeded..."
    npm run db:seed || echo "[SmartParking] Warning: db seed failed or already exists."
fi

echo "[SmartParking] Starting backend..."
exec "$@"

