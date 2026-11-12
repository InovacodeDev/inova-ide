import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function walkAndFix(dir, targetArch) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name.startsWith('win32-') ||
        entry.name.startsWith('linux-') ||
        (entry.name.startsWith('darwin-') && entry.name !== `darwin-${targetArch}`)
      ) {
        rmSync(full, { recursive: true, force: true });
        continue;
      }
      walkAndFix(full, targetArch);
    } else if (entry.name === 'spawn-helper') {
      chmodSync(full, 0o755);
    }
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);
  const resourcesDir = join(appPath, 'Contents', 'Resources');
  const unpackedDir = join(resourcesDir, 'app.asar.unpacked');
  const targetArch = context.arch === 1 ? 'x64' : 'arm64';

  walkAndFix(unpackedDir, targetArch);

  const cliBin = join(resourcesDir, 'bin', 'inova');
  if (existsSync(cliBin)) chmodSync(cliBin, 0o755);

  if (!process.env['CSC_LINK']) {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  }
}
