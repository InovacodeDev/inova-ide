import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WHISPER_REPO = 'https://github.com/ggml-org/whisper.cpp.git';
const WHISPER_TAG = 'v1.9.5';
const MAC_ARCH = { arm64: 'arm64', x64: 'x86_64' };

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function whisperBinaryName(platform) {
  return platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

export function whisperOutDir() {
  return join(desktopDir, 'resources', 'whisper');
}

export function cmakeConfigureArgs({ platform, arch }) {
  const args = [
    '-B',
    'build',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_SERVER=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
  ];
  if (platform === 'darwin') {
    args.push(`-DCMAKE_OSX_ARCHITECTURES=${MAC_ARCH[arch]}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0');
  }
  return args;
}

function findBuiltBinary(buildDir, name) {
  const candidates = [join(buildDir, 'bin', name), join(buildDir, 'bin', 'Release', name)];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`whisper-cli build produced no binary in ${join(buildDir, 'bin')}`);
  return found;
}

export function buildWhisper({ platform, arch }) {
  const outDir = whisperOutDir();
  const target = join(outDir, whisperBinaryName(platform));
  const stampFile = join(outDir, 'build-stamp.txt');
  const stamp = `${WHISPER_TAG} ${platform} ${arch}`;
  if (fs.existsSync(target) && fs.existsSync(stampFile)) {
    if (fs.readFileSync(stampFile, 'utf8') === stamp) return target;
  }

  const workDir = fs.mkdtempSync(join(tmpdir(), 'inova-whisper-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: workDir, stdio: 'inherit' });
  try {
    run('git', ['clone', '--depth', '1', '--branch', WHISPER_TAG, WHISPER_REPO, '.']);
    run('cmake', cmakeConfigureArgs({ platform, arch }));
    run('cmake', ['--build', 'build', '--config', 'Release', '--target', 'whisper-cli', '-j']);
    const built = findBuiltBinary(join(workDir, 'build'), whisperBinaryName(platform));
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(built, target);
    if (platform !== 'win32') fs.chmodSync(target, 0o755);
    fs.writeFileSync(stampFile, stamp);
    return target;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  const built = buildWhisper({ platform: process.platform, arch: process.arch });
  console.log(`whisper-cli ready at ${built}`);
}
