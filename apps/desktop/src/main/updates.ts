import type { Result, UpdateInfo } from '../shared/api.js';
import { fetchUpdateInfo } from './updates-core.js';
import type { FetchLike } from './updates-core.js';

export const STARTUP_CHECK_DELAY_MS = 5000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
