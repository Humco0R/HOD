import { Pool } from 'pg';

export interface PostgresConnection {
  readonly pool: Pool;
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresConnection(databaseUrl: string): PostgresConnection {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  return {
    pool,
    async check() {
      await pool.query('select 1');
    },
    async close() {
      await pool.end();
    },
  };
}
