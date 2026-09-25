import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    migrate: 'src/infrastructure/db/migrate.ts',
  },
  format: ['esm'],
  target: 'es2023',
  clean: true,
  sourcemap: true,
  noExternal: ['@hod/config', '@hod/contracts'],
});
