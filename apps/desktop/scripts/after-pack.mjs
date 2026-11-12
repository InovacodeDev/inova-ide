import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
};

function isForeignPrebuild(name, targetPrebuild) {
  return (
    (name.startsWith('darwin-') || name.startsWith('win32-') || name.startsWith('linux-')) &&
    name !== targetPrebuild
  );
}

function walkAndFix(dir, targetPrebuild, platform) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isForeignPrebuild(entry.name, targetPrebuild)) {
        rmSync(full, { recursive: true, force: true });
        continue;
      }
      walkAndFix(full, targetPrebuild, platform);
    } else if (platform !== 'win32' && entry.name === 'spawn-helper') {
      chmodSync(full, 0o755);
    }
  }
}

export default async function afterPack(context) {
  const platform = context.electronPlatformName;
  const targetArch = ARCH_NAMES[context.arch] ?? 'x64';
  const targetPrebuild = `${platform}-${targetArch}`;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);
  const resourcesDir =
    platform === 'darwin'
      ? join(appPath, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');
  const unpackedDir = join(resourcesDir, 'app.asar.unpacked');

  walkAndFix(unpackedDir, targetPrebuild, platform);

  const binDir = join(resourcesDir, 'bin');
  const posixBin = join(binDir, 'inova');
  const winBin = join(binDir, 'inova.cmd');
  if (platform === 'win32') {
    rmSync(posixBin, { force: true });
  } else {
    rmSync(winBin, { force: true });
    if (existsSync(posixBin)) chmodSync(posixBin, 0o755);
  }

  if (platform === 'darwin' && !process.env['CSC_LINK']) {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  }
}
