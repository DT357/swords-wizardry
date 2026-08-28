import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import Handlebars from 'handlebars';

const root = process.cwd();
const files = collect(join(root, 'module')).filter((file) => file.endsWith('.hbs'));
const failures = [];

for (const file of files) {
  try {
    Handlebars.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${relative(root, file)}: ${error.message}`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Template syntax check passed for ${files.length} Handlebars files.`);
}

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
}
