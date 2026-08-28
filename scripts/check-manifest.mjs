import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'system.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const failures = [];

if (manifest.id !== basename(root)) failures.push('Manifest id must match the package directory.');
if (manifest.version !== packageJson.version) failures.push('Manifest and package versions differ.');
if (!Number.isInteger(manifest.compatibility?.minimum)) {
  failures.push('compatibility.minimum must be an integer generation.');
}
if (!manifest.esmodules?.length) failures.push('At least one ES module is required.');
if (manifest.socket !== true) failures.push('The system socket declaration is required.');

const referencedPaths = [
  ...(manifest.esmodules ?? []),
  ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map((language) => language.path),
  manifest.license,
  manifest.readme,
  manifest.changelog
].filter(Boolean);

for (const path of referencedPaths) {
  if (!existsSync(join(root, path))) failures.push(`Missing manifest path: ${path}`);
}
for (const type of ['character', 'container', 'npc']) {
  if (!manifest.documentTypes?.Actor?.[type]) failures.push(`Missing Actor type: ${type}`);
}
for (const type of ['armor', 'feature', 'item', 'spell', 'weapon']) {
  if (!manifest.documentTypes?.Item?.[type]) failures.push(`Missing Item type: ${type}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Manifest check passed for ${manifest.id} ${manifest.version}.`);
}
