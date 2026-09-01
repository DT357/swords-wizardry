import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const locales = ['en', 'de', 'es'];
const keySets = new Map(locales.map((locale) => {
  const json = JSON.parse(readFileSync(join(root, 'lang', `${locale}.json`), 'utf8'));
  return [locale, new Set(flattenKeys(json))];
}));
const canonical = keySets.get('en');
const failures = [];

for (const locale of locales.slice(1)) {
  const keys = keySets.get(locale);
  const missing = [...canonical].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !canonical.has(key));
  if (missing.length) failures.push(`${locale} missing:\n  ${missing.join('\n  ')}`);
  if (extra.length) failures.push(`${locale} extra:\n  ${extra.join('\n  ')}`);
}
for (const locale of locales) {
  const source = readFileSync(join(root, 'lang', `${locale}.json`), 'utf8');
  if (source.includes('\uFFFD')) failures.push(`${locale} contains a replacement character.`);
}

const staticKeyPattern = /["'](SWORDS_WIZARDRY(?:\.[A-Za-z0-9_-]+)+)["']/g;
for (const directory of ['module', 'templates']) {
  for (const file of collect(join(root, directory))) {
    if (!['.mjs', '.hbs'].includes(extname(file))) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(staticKeyPattern)) {
      const isNamespace = [...canonical].some((key) => key.startsWith(`${match[1]}.`));
      if (!canonical.has(match[1]) && !isNamespace) {
        failures.push(`${relative(root, file)} references missing key ${match[1]}`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Localization parity passed for ${canonical.size} keys in ${locales.length} locales.`);
}

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, path);
  });
}

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
}
