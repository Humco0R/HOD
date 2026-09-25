import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import process, { loadEnvFile } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const environmentPath = resolve(repositoryRoot, '.env');
const targets = {
  smoke: 'apps/backend/src/integrations/ai/smoke-gigachat.ts',
  eval: 'apps/backend/src/integrations/ai/evals/run-gigachat-eval.ts',
};
const task = process.argv[2];
const target = targets[task];

if (!target) {
  process.stderr.write('Expected GigaChat task: smoke or eval\n');
  process.exit(2);
}
if (!existsSync(environmentPath)) {
  process.stderr.write('Root .env file is required for live GigaChat tasks\n');
  process.exit(2);
}

loadEnvFile(environmentPath);

const childEnvironment = { ...process.env };
const caBundlePath = process.env['GIGACHAT_CA_BUNDLE_PATH'];
if (caBundlePath) {
  const resolvedCaBundle = isAbsolute(caBundlePath)
    ? caBundlePath
    : resolve(repositoryRoot, caBundlePath);
  if (!existsSync(resolvedCaBundle)) {
    process.stderr.write('Configured GigaChat CA bundle does not exist\n');
    process.exit(2);
  }
  childEnvironment['NODE_EXTRA_CA_CERTS'] = resolvedCaBundle;
}

const child = spawn(process.execPath, ['--import', 'tsx', resolve(repositoryRoot, target)], {
  cwd: repositoryRoot,
  env: childEnvironment,
  stdio: 'inherit',
});

child.once('error', () => {
  process.stderr.write('Unable to start the GigaChat task\n');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
