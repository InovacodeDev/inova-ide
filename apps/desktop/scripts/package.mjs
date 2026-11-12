import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(desktopDir, '..', '..');

const PLATFORM_FLAGS = { darwin: '--mac', win32: '--win', linux: '--linux' };
const DEFAULT_ARCH = { darwin: 'arm64', win32: 'x64', linux: 'x64' };
const ARTIFACT_EXTS = ['.dmg', '.exe', '.zip', '.AppImage', '.deb', '.tar.gz'];
const SIGNING_ENV_KEYS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];

function parseArg(argv, spec) {
  const idx = argv.indexOf(spec.flag);
  const raw = idx === -1 ? spec.fallback : argv[idx + 1];
  if (spec.allowed.includes(raw)) return raw;
  throw new Error(`Unsupported ${spec.flag}: ${raw}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sanitizedEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of SIGNING_ENV_KEYS) {
    if (!env[key]) delete env[key];
  }
  return env;
}

function run(cmd, args, options) {
  execFileSync(cmd, args, {
    cwd: options.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: sanitizedEnv(options.extraEnv),
  });
}

function sha256File(file) {
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${hash}  ${basename(file)}\n`;
}

function isReleaseArtifact(filePath, name) {
  return fs.statSync(filePath).isFile() && ARTIFACT_EXTS.some((ext) => name.endsWith(ext));
}

const argv = process.argv.slice(2);
const targetPlatform = parseArg(argv, {
  flag: '--platform',
  allowed: ['darwin', 'win32', 'linux'],
  fallback: process.platform,
});
const targetArch = parseArg(argv, {
  flag: '--arch',
  allowed: ['arm64', 'x64'],
  fallback: DEFAULT_ARCH[targetPlatform],
});

const rootPkg = readJson(join(repoRoot, 'package.json'));
const desktopPkg = readJson(join(desktopDir, 'package.json'));
if (rootPkg.version !== desktopPkg.version) {
  throw new Error(`Version mismatch: root=${rootPkg.version} desktop=${desktopPkg.version}`);
}

const electronVersion = readJson(join(desktopDir, 'node_modules/electron/package.json')).version;

run('pnpm', ['build'], { cwd: repoRoot });
run('pnpm', ['--filter', '@inova/desktop', 'build'], { cwd: repoRoot });

const staging = fs.mkdtempSync(join(tmpdir(), 'inova-stage-'));
try {
  run('pnpm', ['--legacy', '--filter', '@inova/desktop', '--prod', 'deploy', staging], {
    cwd: repoRoot,
    extraEnv: { npm_config_ignore_scripts: 'true' },
  });

  const stagePkgPath = join(staging, 'package.json');
  const stagePkg = readJson(stagePkgPath);
  delete stagePkg.scripts;
  fs.writeFileSync(stagePkgPath, `${JSON.stringify(stagePkg, null, 2)}\n`);

  const rebuildArgs = [
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
    '--platform',
    targetPlatform,
  ];
  run('pnpm', rebuildArgs, { cwd: desktopDir });

  for (const dir of ['out', 'build', 'scripts', 'resources']) {
    fs.cpSync(join(desktopDir, dir), join(staging, dir), { recursive: true });
  }
  fs.cpSync(join(desktopDir, 'electron-builder.yml'), join(staging, 'electron-builder.yml'));
  if (targetPlatform !== 'win32') fs.chmodSync(join(staging, 'resources/bin/inova'), 0o755);

  const cliStage = join(staging, 'cli');
  fs.mkdirSync(cliStage, { recursive: true });
  fs.cpSync(join(repoRoot, 'dist'), join(cliStage, 'dist'), { recursive: true });
  fs.writeFileSync(
    join(cliStage, 'package.json'),
    `${JSON.stringify({ name: 'inova', version: rootPkg.version, type: 'module' }, null, 2)}\n`,
  );

  const builderEnv = process.env['CSC_LINK'] ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const builderBin = join(desktopDir, 'node_modules/.bin/electron-builder');
  const builderArgs = [
    PLATFORM_FLAGS[targetPlatform],
    `--${targetArch}`,
    '--publish',
    'never',
    `-c.electronVersion=${electronVersion}`,
  ];
  run(builderBin, builderArgs, { cwd: staging, extraEnv: builderEnv });

  const releaseDir = join(repoRoot, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const distOut = join(staging, 'dist-electron');
  for (const name of fs.readdirSync(distOut)) {
    const src = join(distOut, name);
    if (!isReleaseArtifact(src, name)) continue;
    const dst = join(releaseDir, name);
    fs.cpSync(src, dst);
    fs.writeFileSync(`${dst}.sha256`, sha256File(dst));
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
