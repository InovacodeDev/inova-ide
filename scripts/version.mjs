import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RELATIVE_PACKAGE_PATHS = ['package.json', 'apps/desktop/package.json'];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function resolvePackagePaths(repoRoot = root) {
  return RELATIVE_PACKAGE_PATHS.map((relativePath) => resolve(repoRoot, relativePath));
}

export function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nextVersion(current, target) {
  const [major, minor, patch] = parseSemver(current);
  switch (target) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      parseSemver(target);
      return target;
  }
}

function readPkg(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function checkVersions({ repoRoot = root, tag } = {}) {
  const packagePaths = resolvePackagePaths(repoRoot);
  const versions = packagePaths.map((file) => ({ file, version: readPkg(file).version }));
  const base = versions[0].version;
  parseSemver(base);
  for (const item of versions) {
    if (item.version !== base) {
      throw new Error(`Version mismatch: ${item.file} has ${item.version}, expected ${base}`);
    }
  }
  if (tag !== undefined) {
    const expected = tag.startsWith('v') ? tag.slice(1) : tag;
    if (expected !== base) {
      throw new Error(`Tag ${tag} does not match package version ${base}`);
    }
  }
  return base;
}

export function bumpVersions({ target, repoRoot = root }) {
  const packagePaths = resolvePackagePaths(repoRoot);
  const current = checkVersions({ repoRoot });
  const updated = nextVersion(current, target);
  for (const file of packagePaths) {
    const pkg = readPkg(file);
    pkg.version = updated;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return { current, updated };
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  const [command, arg] = process.argv.slice(2);

  if (command === 'check') {
    const tagFlagIdx = process.argv.indexOf('--tag');
    const rawTag = tagFlagIdx === -1 ? undefined : process.argv[tagFlagIdx + 1];
    console.log(checkVersions({ tag: rawTag }));
  } else if (command === 'bump') {
    if (!arg) throw new Error('Usage: node scripts/version.mjs bump <patch|minor|major|X.Y.Z>');
    const { current, updated } = bumpVersions({ target: arg });
    console.log(`${current} -> ${updated}`);
  } else {
    throw new Error('Usage: node scripts/version.mjs <check [--tag vX.Y.Z]|bump <target>>');
  }
}
