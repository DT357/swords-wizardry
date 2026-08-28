import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const excluded = new Set(['.git', 'dist', 'node_modules']);
const files = collect(root).filter((file) => extname(file) === '.json');
const failures = [];

for (const file of files) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${relative(root, file)}: ${error.message}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`JSON check passed for ${files.length} files.`);
}

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
}
