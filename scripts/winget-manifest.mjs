#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions, parseSemver } from './version.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const WINGET_PACKAGE_ID = 'InovacodeDev.InovaIDE';
export const WINGET_PRODUCT_CODE = 'd7a4c9e2-6b3f-4c81-9f2a-1e5b8a4d7c03';
export const WINGET_MANIFEST_VERSION = '1.9.0';

const SHA256_RE = /^[a-fA-F0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSha256Text(raw) {
  const token = raw.trim().split(/\s+/)[0] ?? '';
  if (!SHA256_RE.test(token)) {
    throw new Error(`Invalid SHA-256 hash: ${raw.trim()}`);
  }
  return token.toUpperCase();
}

export function renderWingetManifests({ version, sha256, releaseDate }) {
  parseSemver(version);
  const normalizedSha = parseSha256Text(sha256);
  if (releaseDate !== undefined && !DATE_RE.test(releaseDate)) {
    throw new Error(`Invalid releaseDate (expected YYYY-MM-DD): ${releaseDate}`);
  }

  const installerUrl = `https://github.com/InovacodeDev/inova-ide/releases/download/v${version}/InovaIDE-${version}-win-x64.exe`;
  const releaseUrl = `https://github.com/InovacodeDev/inova-ide/releases/tag/v${version}`;

  const versionYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${WINGET_MANIFEST_VERSION}.schema.json`,
    '',
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'DefaultLocale: en-US',
    'ManifestType: version',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  const installerLines = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${WINGET_MANIFEST_VERSION}.schema.json`,
    '',
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'InstallerLocale: en-US',
    'Platform:',
    '  - Windows.Desktop',
    'MinimumOSVersion: 10.0.17763.0',
    'InstallerType: nsis',
    'Scope: user',
    'InstallModes:',
    '  - interactive',
    '  - silent',
    '  - silentWithProgress',
    'InstallerSwitches:',
    '  Silent: /S',
    '  SilentWithProgress: /S',
    'UpgradeBehavior: install',
    'Commands:',
    '  - inova',
  ];

  if (releaseDate !== undefined) {
    installerLines.push(`ReleaseDate: ${releaseDate}`);
  }

  installerLines.push(
    'AppsAndFeaturesEntries:',
    '  - DisplayName: InovaIDE',
    '    Publisher: InovacodeDev',
    `    ProductCode: ${WINGET_PRODUCT_CODE}`,
    '    InstallerType: nsis',
    'Installers:',
    '  - Architecture: x64',
    `    InstallerUrl: ${installerUrl}`,
    `    InstallerSha256: ${normalizedSha}`,
    'ManifestType: installer',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  );

  const enUsYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${WINGET_MANIFEST_VERSION}.schema.json`,
    '',
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'PackageLocale: en-US',
    'Publisher: InovacodeDev',
    'PublisherUrl: https://github.com/InovacodeDev',
    'PublisherSupportUrl: https://github.com/InovacodeDev/inova-ide/issues',
    'Author: InovacodeDev',
    'PackageName: InovaIDE',
    'PackageUrl: https://github.com/InovacodeDev/inova-ide',
    'License: Proprietary',
    'LicenseUrl: https://github.com/InovacodeDev/inova-ide/blob/main/LICENSE',
    'Copyright: Copyright (c) 2026 InovacodeDev',
    'ShortDescription: Multi-provider IDE and CLI for local coding agents',
    'Description: Multi-account workspace and launcher for Claude, Codex, and Gemini coding agents.',
    'Moniker: inova-ide',
    'Tags:',
    '  - ide',
    '  - ai',
    '  - cli',
    '  - developer-tools',
    `ReleaseNotesUrl: ${releaseUrl}`,
    'ManifestType: defaultLocale',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  const ptBrYaml = [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.${WINGET_MANIFEST_VERSION}.schema.json`,
    '',
    `PackageIdentifier: ${WINGET_PACKAGE_ID}`,
    `PackageVersion: ${version}`,
    'PackageLocale: pt-BR',
    'Publisher: InovacodeDev',
    'PackageName: InovaIDE',
    'License: Proprietary',
    'LicenseUrl: https://github.com/InovacodeDev/inova-ide/blob/main/LICENSE',
    'ShortDescription: IDE e CLI multi-conta para agentes de código locais',
    'Description: Workspace desktop e CLI multi-conta para os agentes Claude, Codex e Gemini.',
    `ReleaseNotesUrl: ${releaseUrl}`,
    'ManifestType: locale',
    `ManifestVersion: ${WINGET_MANIFEST_VERSION}`,
    '',
  ].join('\n');

  return {
    versionYaml,
    installerYaml: installerLines.join('\n'),
    enUsYaml,
    ptBrYaml,
  };
}

export function manifestDirectory({ repoRoot = defaultRoot, version }) {
  return join(
    repoRoot,
    'packaging',
    'winget',
    'manifests',
    'i',
    'InovacodeDev',
    'InovaIDE',
    version,
  );
}

export function writeWingetManifests({
  repoRoot = defaultRoot,
  outDir,
  version,
  sha256,
  releaseDate,
}) {
  const targetDir = outDir ?? manifestDirectory({ repoRoot, version });
  const manifests = renderWingetManifests({ version, sha256, releaseDate });
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, `${WINGET_PACKAGE_ID}.yaml`), manifests.versionYaml);
  writeFileSync(join(targetDir, `${WINGET_PACKAGE_ID}.installer.yaml`), manifests.installerYaml);
  writeFileSync(join(targetDir, `${WINGET_PACKAGE_ID}.locale.en-US.yaml`), manifests.enUsYaml);
  writeFileSync(join(targetDir, `${WINGET_PACKAGE_ID}.locale.pt-BR.yaml`), manifests.ptBrYaml);
  return targetDir;
}

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  const argv = process.argv.slice(2);
  const version = readFlag(argv, '--version') ?? checkVersions({ repoRoot: defaultRoot });
  const shaFlag = readFlag(argv, '--sha256');
  const shaFileFlag = readFlag(argv, '--sha256-file');
  const outDir = readFlag(argv, '--out-dir');
  const releaseDate = readFlag(argv, '--release-date');

  const shaRaw =
    shaFlag ??
    readFileSync(
      shaFileFlag ?? join(defaultRoot, 'release', `InovaIDE-${version}-win-x64.exe.sha256`),
      'utf8',
    );
  const writtenDir = writeWingetManifests({
    repoRoot: defaultRoot,
    outDir,
    version,
    sha256: shaRaw,
    releaseDate,
  });
  console.log(writtenDir);
}
