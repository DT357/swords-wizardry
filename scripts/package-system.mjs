import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';
import archiver from 'archiver';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'system.json'), 'utf8'));
const allowlist = JSON.parse(readFileSync(join(root, 'release-files.json'), 'utf8'));
const outputRoot = resolve(root, 'dist');
const stageRoot = resolve(outputRoot, manifest.id);
const archivePath = resolve(outputRoot, `${manifest.id}.zip`);
const manifestPath = resolve(outputRoot, 'system.json');
const checksumPath = resolve(outputRoot, 'SHA256SUMS.txt');
const fixedArchiveDate = new Date('1980-01-01T00:00:00.000Z');

assertSafeOutputPath(outputRoot);
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const releaseFiles = collectReleaseFiles(allowlist);
validateReleaseFiles(releaseFiles);
for (const file of releaseFiles) {
  const destination = join(stageRoot, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
}
copyFileSync(join(root, 'system.json'), manifestPath);

await writeArchive(releaseFiles);
const checksumLines = [archivePath, manifestPath].map((file) => (
  `${sha256(file)}  ${relative(outputRoot, file).split(sep).join('/')}`
));
writeFileSync(checksumPath, `${checksumLines.join('\n')}\n`, 'utf8');

console.log(`Packaged ${releaseFiles.length} files for ${manifest.id} ${manifest.version}.`);
console.log(relative(root, archivePath));
console.log(relative(root, checksumPath));

function collectReleaseFiles(config) {
  const files = new Set();
  for (const file of config.files ?? []) {
    assertRelativePath(file);
    if (!existsSync(join(root, file)) || !statSync(join(root, file)).isFile()) {
      throw new Error(`Missing release file: ${file}`);
    }
    files.add(normalizePath(file));
  }

  for (const entry of config.directories ?? []) {
    assertRelativePath(entry.path);
    const directory = join(root, entry.path);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      throw new Error(`Missing release directory: ${entry.path}`);
    }
    const exactFiles = new Set(entry.files ?? []);
    const extensions = new Set(entry.extensions ?? []);
    for (const absolutePath of collectFiles(directory)) {
      const relativeToDirectory = normalizePath(relative(directory, absolutePath));
      if (
        exactFiles.has(relativeToDirectory)
        || extensions.has(extname(relativeToDirectory).toLowerCase())
      ) {
        files.add(normalizePath(relative(root, absolutePath)));
      }
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function validateReleaseFiles(files) {
  const required = [
    'system.json',
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map((language) => language.path),
    manifest.license,
    manifest.readme,
    manifest.changelog
  ].filter(Boolean).map(normalizePath);
  for (const path of required) {
    if (!files.includes(path)) throw new Error(`Required manifest path is not packaged: ${path}`);
  }

  const forbiddenSegments = new Set([
    '.git', 'dist', 'node_modules', 'scripts', 'tests', 'scss'
  ]);
  for (const file of files) {
    const segments = file.split('/');
    if (segments.some((segment) => forbiddenSegments.has(segment))) {
      throw new Error(`Forbidden release path: ${file}`);
    }
    if (file.endsWith('.map') || file.endsWith('~')) {
      throw new Error(`Forbidden generated or backup file: ${file}`);
    }
  }
}

async function writeArchive(files) {
  const output = createWriteStream(archivePath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const completion = once(output, 'close');
  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  archive.on('error', (error) => output.destroy(error));
  archive.pipe(output);
  for (const file of files) {
    archive.append(readFileSync(join(root, file)), {
      name: file,
      date: fixedArchiveDate,
      mode: 0o644
    });
  }
  await archive.finalize();
  await completion;
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function assertRelativePath(path) {
  const resolvedPath = resolve(root, path);
  const relativePath = relative(root, resolvedPath);
  if (
    !path
    || relativePath.startsWith('..')
    || relativePath.includes(`..${sep}`)
    || resolvedPath === root
  ) {
    throw new Error(`Unsafe release path: ${path}`);
  }
}

function assertSafeOutputPath(path) {
  if (path !== resolve(root, 'dist') || dirname(path) !== root) {
    throw new Error(`Refusing to replace unexpected output path: ${path}`);
  }
}

function normalizePath(path) {
  return path.split(sep).join('/');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
