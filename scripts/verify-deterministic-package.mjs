import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const archive = join(root, 'dist', 'swords-wizardry.zip');
const firstHash = sha256(archive);
const rebuilt = spawnSync(process.execPath, ['scripts/package-system.mjs'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'pipe'
});
if (rebuilt.status !== 0) {
  process.stderr.write(rebuilt.stderr || rebuilt.stdout);
  process.exit(rebuilt.status ?? 1);
}
const secondHash = sha256(archive);
if (firstHash !== secondHash) {
  throw new Error(`Release archive is not deterministic: ${firstHash} != ${secondHash}`);
}
console.log(`Deterministic archive verified: ${secondHash}`);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
