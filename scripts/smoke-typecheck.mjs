import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);
run('npx', ['tsc', '-p', 'tsconfig.electron.json']);
run('npx', ['vite', 'build']);
console.log('smoke-typecheck: OK');
