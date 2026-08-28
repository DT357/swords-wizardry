import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const excluded = new Set(['.git', 'dist', 'node_modules']);
const files = collect(root).filter((file) => extname(file) === '.mjs');
const failures = [];

for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8'
  });
  if (check.status !== 0) {
    failures.push(`${relative(root, file)}\n${check.stderr || check.stdout}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} JavaScript modules.`);
}

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
}
