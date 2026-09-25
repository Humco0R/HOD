import eslint from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'import-x/no-cycle': 'error',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.js', '**/*.mjs'],
  },
  {
    files: ['apps/backend/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'fastify',
            '@maxhub/max-bot-api',
            'drizzle-orm',
            'ioredis',
            'bullmq',
            'gigachat',
            '**/transport/**',
            '**/infrastructure/**',
            '**/integrations/**',
          ],
        },
      ],
    },
  },
  {
    files: ['apps/backend/src/modules/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/transport/**'] }],
    },
  },
);
