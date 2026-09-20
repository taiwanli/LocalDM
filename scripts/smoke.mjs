import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'cli.mjs');

// Compile-free run via tsc project output
function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['tsc', '-p', 'tsconfig.electron.json']);
run('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']);
// smoke scripts compiled with electron tsconfig include only electron/shared — compile scripts separately
run('npx', [
  'tsc',
  'scripts/smoke-m1.ts',
  'scripts/smoke-api.ts',
  'scripts/smoke-api-crud.ts',
  'scripts/smoke-queue.ts',
  'scripts/smoke-m3.ts',
  'scripts/smoke-complete.ts',
  'scripts/smoke-task-limit.ts',
  'scripts/smoke-m4.ts',
  'scripts/smoke-m4-live.ts',
  'scripts/smoke-yt-limit.ts',
  'scripts/smoke-m5.ts',
  'scripts/smoke-bt.ts',
  'scripts/smoke-takeover.ts',
  'scripts/smoke-mode.ts',
  'scripts/smoke-adaptive.ts',
  'scripts/smoke-p2.ts',
  'scripts/smoke-p3.ts',
  'scripts/smoke-p4.ts',
  'scripts/smoke-p1.ts',
  'scripts/local-test-server.ts',
  '--outDir',
  'dist-smoke',
  '--module',
  'commonjs',
  '--target',
  'ES2022',
  '--esModuleInterop',
  '--skipLibCheck',
  '--resolveJsonModule',
  '--strict',
]);
run('node', ['dist-smoke/scripts/smoke-api.js']);
run('node', ['dist-smoke/scripts/smoke-api-crud.js']);
run('node', ['dist-smoke/scripts/smoke-m1.js']);
run('node', ['dist-smoke/scripts/smoke-queue.js']);
run('node', ['dist-smoke/scripts/smoke-m3.js']);
run('node', ['dist-smoke/scripts/smoke-complete.js']);
run('node', ['dist-smoke/scripts/smoke-task-limit.js']);
run('node', ['dist-smoke/scripts/smoke-m4.js']);
// Live HLS depends on public CDN; WARN path exits 0.
run('node', ['dist-smoke/scripts/smoke-m4-live.js']);
run('node', ['dist-smoke/scripts/smoke-yt-limit.js']);
run('node', ['dist-smoke/scripts/smoke-m5.js']);
run('node', ['dist-smoke/scripts/smoke-bt.js']);
run('node', ['dist-smoke/scripts/smoke-takeover.js']);
run('node', ['dist-smoke/scripts/smoke-mode.js']);
run('node', ['dist-smoke/scripts/smoke-adaptive.js']);
run('node', ['dist-smoke/scripts/smoke-p2.js']);
run('node', ['dist-smoke/scripts/smoke-p3.js']);
run('node', ['dist-smoke/scripts/smoke-p4.js']);
run('node', ['dist-smoke/scripts/smoke-p1.js']);
console.log('smoke-all: OK');
void tsx;
