import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePaths = [resolve(root, 'package.json'), resolve(root, 'apps/desktop/package.json')];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextVersion(current, target) {
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

const [command, arg] = process.argv.slice(2);

if (command === 'check') {
  const versions = packagePaths.map((file) => ({ file, version: readPkg(file).version }));
  const base = versions[0].version;
  parseSemver(base);
  for (const item of versions) {
    if (item.version !== base) {
      throw new Error(`Version mismatch: ${item.file} has ${item.version}, expected ${base}`);
    }
  }
  const tagFlagIdx = process.argv.indexOf('--tag');
  const rawTag = tagFlagIdx === -1 ? undefined : process.argv[tagFlagIdx + 1];
  if (rawTag !== undefined) {
    const expected = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
    if (expected !== base) {
      throw new Error(`Tag ${rawTag} does not match package version ${base}`);
    }
  }
  console.log(base);
} else if (command === 'bump') {
  if (!arg) throw new Error('Usage: node scripts/version.mjs bump <patch|minor|major|X.Y.Z>');
  const current = readPkg(packagePaths[0]).version;
  const updated = nextVersion(current, arg);
  for (const file of packagePaths) {
    const pkg = readPkg(file);
    pkg.version = updated;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(`${current} -> ${updated}`);
} else {
  throw new Error('Usage: node scripts/version.mjs <check [--tag vX.Y.Z]|bump <target>>');
}
