import type { Result, UpdateInfo, UpdateInstallStage } from '../shared/api.js';
import { compareVersions, fetchUpdateInfo, isValidVersion } from './updates-core.js';
import type { FetchLike } from './updates-core.js';
import { fail, ok } from './validation.js';

export const STARTUP_CHECK_DELAY_MS = 5000;
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export interface UpdateServiceDeps {
  current: string;
  fetch: FetchLike;
  onAvailable: (info: UpdateInfo) => void;
}

export function createUpdateService(deps: UpdateServiceDeps) {
  let announcedVersion: string | null = null;
  let warned = false;

  async function check(): Promise<Result<UpdateInfo>> {
    const result = await fetchUpdateInfo({ current: deps.current, fetch: deps.fetch });
    if (!result.ok) {
      if (!warned) console.warn('inova: update check failed');
      warned = true;
      return result;
    }
    const info = result.value;
    if (info.available && info.latest !== announcedVersion) {
      announcedVersion = info.latest;
      deps.onAvailable(info);
    }
    return result;
  }

  function start(): () => void {
    const run = (): void => void check();
    const first = setTimeout(run, STARTUP_CHECK_DELAY_MS);
    const interval = setInterval(run, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }

  return { current: deps.current, check, start };
}

export type UpdateService = ReturnType<typeof createUpdateService>;

export const CASK_NAME = 'inova-ide';
export const WINGET_PACKAGE_ID = 'InovacodeDev.InovaIDE';
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const XATTR_PATH = '/usr/bin/xattr';
// REGEX: captures the `.app` bundle root from `<bundle>.app/Contents/MacOS/<binary>`
const BUNDLE_PATTERN = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/;

export interface WinUpgradeInput {
  winget: string;
  execPath: string;
  pid: number;
}

export interface UpdateInstallerDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  current: string;
  execPath: string;
  findBrew: () => Promise<string | undefined>;
  run: (file: string, args: string[]) => Promise<void>;
  readBundleVersion: (bundle: string) => Promise<string>;
  relaunch: () => void;
  onProgress: (stage: UpdateInstallStage) => void;
  findWinget?: () => Promise<string | undefined>;
  isWinInstalled?: (execPath: string) => boolean;
  runOutput?: (file: string, args: string[]) => Promise<string>;
  spawnWinUpgrade?: (input: WinUpgradeInput) => Promise<void>;
  quit?: () => void;
  pid?: number;
}

export function appBundlePath(execPath: string): string | null {
  return BUNDLE_PATTERN.exec(execPath)?.[1] ?? null;
}

export function parseWingetAvailableVersion(stdout: string): string | null {
  let latest: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const token = rawLine.trim();
    if (!isValidVersion(token)) continue;
    const normalized = token.replace(/^v/, '');
    if (latest === null || compareVersions(normalized, latest) > 0) {
      latest = normalized;
    }
  }
  return latest;
}

export function createUpdateInstaller(deps: UpdateInstallerDeps) {
  let inFlight: Promise<Result<null>> | null = null;

  async function runMacInstall(): Promise<Result<null>> {
    const bundle = appBundlePath(deps.execPath);
    if (!deps.isPackaged || bundle === null) {
      return fail('A atualização automática só funciona no app instalado.');
    }
    deps.onProgress('preparing');
    const brew = await deps.findBrew();
    if (brew === undefined) {
      return fail('Homebrew não encontrado. Instale a atualização pelo terminal.');
    }
    let installed: string;
    try {
      deps.onProgress('fetching');
      await deps.run(brew, ['update']);
      deps.onProgress('downloading');
      await deps.run(brew, ['upgrade', '--cask', CASK_NAME]);
      deps.onProgress('finalizing');
      await deps.run(XATTR_PATH, ['-dr', 'com.apple.quarantine', bundle]);
      installed = await deps.readBundleVersion(bundle);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      console.error('inova: update install failed', error.message);
      return fail(
        `Falha ao instalar a atualização. Rode no terminal: brew upgrade --cask ${CASK_NAME}`,
      );
    }
    if (compareVersions(installed, deps.current) <= 0) {
      return fail('A versão nova ainda não chegou ao Homebrew. Tente de novo em alguns minutos.');
    }
    deps.onProgress('restarting');
    deps.relaunch();
    return ok(null);
  }

  async function runWinInstall(): Promise<Result<null>> {
    if (!deps.isPackaged || !(deps.isWinInstalled?.(deps.execPath) ?? false)) {
      return fail('A atualização automática só funciona no app instalado.');
    }
    deps.onProgress('preparing');
    const winget = await deps.findWinget?.();
    if (winget === undefined) {
      return fail(
        `Winget não encontrado. Atualize pelo terminal: winget upgrade --id ${WINGET_PACKAGE_ID} --exact`,
      );
    }
    if (!deps.runOutput || !deps.spawnWinUpgrade) {
      return fail('A atualização automática não está configurada neste ambiente.');
    }
    let available: string | null;
    try {
      deps.onProgress('fetching');
      const output = await deps.runOutput(winget, [
        'show',
        '--id',
        WINGET_PACKAGE_ID,
        '--exact',
        '--versions',
        '--accept-source-agreements',
      ]);
      available = parseWingetAvailableVersion(output);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      console.error('inova: winget query failed', error.message);
      return fail(
        `Falha ao consultar o Winget. Rode no terminal: winget upgrade --id ${WINGET_PACKAGE_ID} --exact`,
      );
    }
    if (available === null || compareVersions(available, deps.current) <= 0) {
      return fail('A versão nova ainda não chegou ao Winget. Tente de novo em alguns minutos.');
    }
    try {
      deps.onProgress('downloading');
      await deps.spawnWinUpgrade({
        winget,
        execPath: deps.execPath,
        pid: deps.pid ?? process.pid,
      });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      console.error('inova: winget upgrade failed', error.message);
      return fail(
        `Falha ao instalar a atualização. Rode no terminal: winget upgrade --id ${WINGET_PACKAGE_ID} --exact`,
      );
    }
    deps.onProgress('restarting');
    (deps.quit ?? deps.relaunch)();
    return ok(null);
  }

  async function runInstall(): Promise<Result<null>> {
    if (deps.platform === 'darwin') return runMacInstall();
    if (deps.platform === 'win32') return runWinInstall();
    return fail('A atualização automática não está disponível nesta plataforma.');
  }

  function install(): Promise<Result<null>> {
    inFlight ??= runInstall().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { install };
}

export type UpdateInstaller = ReturnType<typeof createUpdateInstaller>;
