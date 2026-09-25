import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { loadRuntimeConfig } from '@hod/config';

import { createDatabase } from './client';
import { createPostgresConnection } from './postgres';

const config = loadRuntimeConfig();
const postgres = createPostgresConnection(config.DATABASE_URL);
const migrationsFolder = process.env.MIGRATIONS_PATH ?? resolve(process.cwd(), 'drizzle');

try {
  await migrate(createDatabase(postgres.pool), { migrationsFolder });
  process.stdout.write(`Migrations applied from ${migrationsFolder}\n`);
} finally {
  await postgres.close();
}
