import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stageProdDeps } from './package.mjs';

const tempDirs = [];

function makeTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writePkg(dir, pkg) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('stageProdDeps', () => {
  it('stages transitive prod deps as real directories and strips devDeps and scripts', () => {
    const root = makeTemp('inova-pkg-stage-');
    const sourceDir = join(root, 'apps/desktop');
    const stagingDir = join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });

    const storePty = join(root, 'node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty');
    const storeAddon = join(
      root,
      'node_modules/.pnpm/node-addon-api@7.1.1/node_modules/node-addon-api',
    );
    const storeScoped = join(root, 'node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg');
    const storeDev = join(root, 'node_modules/.pnpm/vite@1.0.0/node_modules/vite');

    writePkg(storePty, {
      name: 'node-pty',
      version: '1.1.0',
      dependencies: { 'node-addon-api': '^7.1.0' },
    });
    writePkg(storeAddon, { name: 'node-addon-api', version: '7.1.1' });
    writePkg(storeScoped, { name: '@scope/pkg', version: '1.0.0' });
    writePkg(storeDev, { name: 'vite', version: '1.0.0' });

    mkdirSync(join(storePty, '../'), { recursive: true });
    symlinkSync(storeAddon, join(dirname(storePty), 'node-addon-api'), 'dir');

    writePkg(sourceDir, {
      name: '@inova/desktop',
      version: '0.3.0',
      scripts: { postinstall: 'echo skip' },
      dependencies: { 'node-pty': '^1.1.0' },
      optionalDependencies: { '@scope/pkg': '^1.0.0', 'missing-opt': '^1.0.0' },
      devDependencies: { vite: '^1.0.0' },
    });

    mkdirSync(join(sourceDir, 'node_modules/@scope'), { recursive: true });
    symlinkSync(storePty, join(sourceDir, 'node_modules/node-pty'), 'dir');
    symlinkSync(storeScoped, join(sourceDir, 'node_modules/@scope/pkg'), 'dir');
    symlinkSync(storeDev, join(sourceDir, 'node_modules/vite'), 'dir');

    stageProdDeps({ sourceDir, stagingDir });

    const stagedPkg = JSON.parse(readFileSync(join(stagingDir, 'package.json'), 'utf8'));
    assert.equal(stagedPkg.scripts, undefined);
    assert.equal(stagedPkg.devDependencies, undefined);

    assert.equal(lstatSync(join(stagingDir, 'node_modules/node-pty')).isSymbolicLink(), false);
    assert.equal(
      lstatSync(join(stagingDir, 'node_modules/node-addon-api')).isSymbolicLink(),
      false,
    );
    assert.equal(lstatSync(join(stagingDir, 'node_modules/@scope/pkg')).isSymbolicLink(), false);
    assert.equal(existsSync(join(stagingDir, 'node_modules/vite')), false);
  });

  it('nests conflicting dependency versions instead of overwriting hoisted copy', () => {
    const root = makeTemp('inova-pkg-conflict-');
    const sourceDir = join(root, 'app');
    const stagingDir = join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });

    const pkgA = join(root, 'store/a');
    const pkgB = join(root, 'store/b');
    const sharedV1 = join(root, 'store/shared@1');
    const sharedV2 = join(root, 'store/shared@2');

    writePkg(sharedV1, { name: 'shared', version: '1.0.0' });
    writePkg(sharedV2, { name: 'shared', version: '2.0.0' });
    writePkg(pkgA, { name: 'a', version: '1.0.0', dependencies: { shared: '^1.0.0' } });
    writePkg(pkgB, { name: 'b', version: '1.0.0', dependencies: { shared: '^2.0.0' } });

    mkdirSync(join(pkgA, 'node_modules'), { recursive: true });
    symlinkSync(sharedV1, join(pkgA, 'node_modules/shared'), 'dir');
    mkdirSync(join(pkgB, 'node_modules'), { recursive: true });
    symlinkSync(sharedV2, join(pkgB, 'node_modules/shared'), 'dir');

    writePkg(sourceDir, {
      name: 'app',
      version: '1.0.0',
      dependencies: { a: '1.0.0', b: '1.0.0' },
    });
    mkdirSync(join(sourceDir, 'node_modules'), { recursive: true });
    symlinkSync(pkgA, join(sourceDir, 'node_modules/a'), 'dir');
    symlinkSync(pkgB, join(sourceDir, 'node_modules/b'), 'dir');

    stageProdDeps({ sourceDir, stagingDir });

    const hoisted = JSON.parse(
      readFileSync(join(stagingDir, 'node_modules/shared/package.json'), 'utf8'),
    );
    const nested = JSON.parse(
      readFileSync(join(stagingDir, 'node_modules/b/node_modules/shared/package.json'), 'utf8'),
    );
    assert.equal(hoisted.version, '1.0.0');
    assert.equal(nested.version, '2.0.0');
  });

  it('throws when a required production dependency is missing', () => {
    const root = makeTemp('inova-pkg-missing-');
    const sourceDir = join(root, 'app');
    const stagingDir = join(root, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writePkg(sourceDir, { name: 'app', version: '1.0.0', dependencies: { nope: '^1.0.0' } });

    assert.throws(
      () => stageProdDeps({ sourceDir, stagingDir }),
      /Missing production dependency "nope"/,
    );
  });

  it('stages real desktop dependencies from workspace', () => {
    const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const stagingDir = makeTemp('inova-pkg-real-');

    stageProdDeps({ sourceDir: desktopDir, stagingDir });

    assert.equal(existsSync(join(stagingDir, 'node_modules/node-pty/package.json')), true);
    assert.equal(existsSync(join(stagingDir, 'node_modules/node-addon-api/package.json')), true);
  });
});
