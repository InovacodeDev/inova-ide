import type { Result, UpdateInfo } from '../shared/api.js';
import { compareVersions, fetchUpdateInfo } from './updates-core.js';
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
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const XATTR_PATH = '/usr/bin/xattr';
// REGEX: captures the `.app` bundle root from `<bundle>.app/Contents/MacOS/<binary>`
const BUNDLE_PATTERN = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/;

export interface UpdateInstallerDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  current: string;
  execPath: string;
  findBrew: () => Promise<string | undefined>;
  run: (file: string, args: string[]) => Promise<void>;
  readBundleVersion: (bundle: string) => Promise<string>;
  relaunch: () => void;
}

export function appBundlePath(execPath: string): string | null {
  return BUNDLE_PATTERN.exec(execPath)?.[1] ?? null;
}

export function createUpdateInstaller(deps: UpdateInstallerDeps) {
  let inFlight: Promise<Result<null>> | null = null;

  async function runInstall(): Promise<Result<null>> {
    const bundle = appBundlePath(deps.execPath);
    if (deps.platform !== 'darwin' || !deps.isPackaged || bundle === null) {
      return fail('A atualização automática só funciona no app instalado no macOS.');
    }
    const brew = await deps.findBrew();
    if (brew === undefined) {
      return fail('Homebrew não encontrado. Instale a atualização pelo terminal.');
    }
    let installed: string;
    try {
      await deps.run(brew, ['update']);
      await deps.run(brew, ['upgrade', '--cask', CASK_NAME]);
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
    deps.relaunch();
    return ok(null);
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
