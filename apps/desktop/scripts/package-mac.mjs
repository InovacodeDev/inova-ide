import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '..', '..');

function parseArch(argv) {
  const idx = argv.indexOf('--arch');
  const raw = idx === -1 ? process.arch : argv[idx + 1];
  if (raw === 'arm64' || raw === 'x64') return raw;
  throw new Error(`Unsupported arch: ${raw}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function run(cmd, args, cwd, extraEnv = {}) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

function sha256File(file) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  return `${hash}  ${file.split('/').pop()}\n`;
}

const targetArch = parseArch(process.argv.slice(2));
const rootPkg = readJson(join(repoRoot, 'package.json'));
const desktopPkg = readJson(join(desktopDir, 'package.json'));
if (rootPkg.version !== desktopPkg.version) {
  throw new Error(`Version mismatch: root=${rootPkg.version} desktop=${desktopPkg.version}`);
}

const electronPkg = readJson(join(desktopDir, 'node_modules', 'electron', 'package.json'));
const electronVersion = electronPkg.version;

run('pnpm', ['build'], repoRoot);
run('pnpm', ['--filter', '@inova/desktop', 'build'], repoRoot);

const staging = mkdtempSync(join(tmpdir(), 'inova-stage-'));
try {
  run('pnpm', ['--legacy', '--filter', '@inova/desktop', '--prod', 'deploy', staging], repoRoot, {
    npm_config_ignore_scripts: 'true',
  });

  const stagePkgPath = join(staging, 'package.json');
  const stagePkg = readJson(stagePkgPath);
  delete stagePkg.scripts;
  writeFileSync(stagePkgPath, `${JSON.stringify(stagePkg, null, 2)}\n`);

  run(
    'pnpm',
    [
      'exec',
      'electron-rebuild',
      '-f',
      '-w',
      'node-pty',
      '-m',
      staging,
      '-v',
      electronVersion,
      '-a',
      targetArch,
    ],
    desktopDir,
  );

  cpSync(join(desktopDir, 'out'), join(staging, 'out'), { recursive: true });
  cpSync(join(desktopDir, 'build'), join(staging, 'build'), { recursive: true });
  cpSync(join(desktopDir, 'scripts'), join(staging, 'scripts'), { recursive: true });
  cpSync(join(desktopDir, 'resources'), join(staging, 'resources'), { recursive: true });
  cpSync(join(desktopDir, 'electron-builder.yml'), join(staging, 'electron-builder.yml'));
  chmodSync(join(staging, 'resources', 'bin', 'inova'), 0o755);

  const cliStage = join(staging, 'cli');
  mkdirSync(cliStage, { recursive: true });
  cpSync(join(repoRoot, 'dist'), join(cliStage, 'dist'), { recursive: true });
  writeFileSync(
    join(cliStage, 'package.json'),
    `${JSON.stringify({ name: 'inova', version: rootPkg.version, type: 'module' }, null, 2)}\n`,
  );

  const builderEnv = process.env['CSC_LINK'] ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const builderBin = join(desktopDir, 'node_modules', '.bin', 'electron-builder');
  run(
    builderBin,
    ['--mac', `--${targetArch}`, '--publish', 'never', `-c.electronVersion=${electronVersion}`],
    staging,
    builderEnv,
  );

  const releaseDir = join(repoRoot, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const distOut = join(staging, 'dist-electron');
  for (const name of readdirSync(distOut)) {
    if (!name.endsWith('.dmg')) continue;
    const src = join(distOut, name);
    const dst = join(releaseDir, name);
    cpSync(src, dst);
    writeFileSync(`${dst}.sha256`, sha256File(dst));
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
