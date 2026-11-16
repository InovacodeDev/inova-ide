import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  WINGET_PACKAGE_ID,
  WINGET_PRODUCT_CODE,
  parseSha256Text,
  renderWingetManifests,
  writeWingetManifests,
} from './winget-manifest.mjs';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseSha256Text', () => {
  it('extracts and uppercases hash from sha256sum file output', () => {
    const raw =
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  InovaIDE-0.9.0-win-x64.exe\n';
    assert.equal(
      parseSha256Text(raw),
      'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
    );
  });

  it('rejects malformed hashes', () => {
    assert.throws(() => parseSha256Text('not-a-hash'), /Invalid SHA-256/);
  });
});

describe('renderWingetManifests', () => {
  it('renders valid version, installer and locale manifests', () => {
    const sha = 'a'.repeat(64);
    const manifests = renderWingetManifests({
      version: '0.9.0',
      sha256: sha,
      releaseDate: '2026-11-16',
    });

    assert.match(manifests.versionYaml, /PackageIdentifier: InovacodeDev\.InovaIDE/);
    assert.match(manifests.versionYaml, /PackageVersion: 0\.9\.0/);
    assert.match(manifests.versionYaml, /DefaultLocale: en-US/);

    assert.match(manifests.installerYaml, /InstallerType: nullsoft/);
    assert.match(manifests.installerYaml, /Scope: user/);
    assert.match(manifests.installerYaml, /Silent: \/S/);
    assert.match(manifests.installerYaml, /Commands:\n  - inova/);
    assert.match(manifests.installerYaml, /ReleaseDate: 2026-11-16/);
    assert.match(manifests.installerYaml, new RegExp(`ProductCode: ${WINGET_PRODUCT_CODE}`));
    assert.match(
      manifests.installerYaml,
      /InstallerUrl: https:\/\/github\.com\/InovacodeDev\/inova-ide\/releases\/download\/v0\.9\.0\/InovaIDE-0\.9\.0-win-x64\.exe/,
    );
    assert.match(manifests.installerYaml, new RegExp(`InstallerSha256: ${'A'.repeat(64)}`));

    assert.match(manifests.enUsYaml, /License: Proprietary/);
    assert.match(
      manifests.enUsYaml,
      /LicenseUrl: https:\/\/github\.com\/InovacodeDev\/inova-ide\/blob\/main\/LICENSE/,
    );
    assert.match(manifests.ptBrYaml, /PackageLocale: pt-BR/);
  });

  it('rejects invalid version or releaseDate', () => {
    assert.throws(
      () => renderWingetManifests({ version: 'v0.9.0', sha256: 'a'.repeat(64) }),
      /Invalid semver/,
    );
    assert.throws(
      () =>
        renderWingetManifests({
          version: '0.9.0',
          sha256: 'a'.repeat(64),
          releaseDate: '16-11-2026',
        }),
      /Invalid releaseDate/,
    );
  });
});

describe('writeWingetManifests', () => {
  it('writes all four manifest yaml files into the target directory', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'inova-winget-'));
    tempDirs.push(outDir);

    writeWingetManifests({
      outDir,
      version: '0.9.0',
      sha256: 'b'.repeat(64),
    });

    for (const suffix of ['.yaml', '.installer.yaml', '.locale.en-US.yaml', '.locale.pt-BR.yaml']) {
      const file = join(outDir, `${WINGET_PACKAGE_ID}${suffix}`);
      assert.equal(existsSync(file), true);
      assert.match(readFileSync(file, 'utf8'), /PackageIdentifier: InovacodeDev\.InovaIDE/);
    }
  });
});
