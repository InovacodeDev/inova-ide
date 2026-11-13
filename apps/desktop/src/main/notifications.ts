import type { Result } from '../shared/api.js';
import { fail, ok } from './validation.js';

export interface NotificationInput {
  title: string;
  body: string;
}

export interface NotifierDeps {
  platform: NodeJS.Platform;
  isSupported: () => boolean;
  showNative: (input: NotificationInput) => Promise<string | null>;
  runOsascript: (args: string[]) => Promise<void>;
}

export const NOTIFICATION_SETTINGS_URL: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  win32: 'ms-settings:notifications',
};

const BLOCKED_MESSAGE =
  'O sistema bloqueou a notificação. Permita as notificações do InovaIDE nos ajustes do sistema.';
const UNSUPPORTED_MESSAGE = 'Este sistema não oferece notificações.';

// NOTE: the title and body travel as argv, never inside the script text, so they cannot inject
// AppleScript.
const OSASCRIPT_ARGS = [
  '-e',
  'on run argv',
  '-e',
  'display notification (item 2 of argv) with title (item 1 of argv)',
  '-e',
  'end run',
];

export function createNotifier(deps: NotifierDeps) {
  // NOTE: macOS refuses UNUserNotificationCenter for ad-hoc signed apps without ever showing the
  // permission prompt (UNErrorDomain 1); osascript still delivers until the app is signed with a
  // Developer ID.
  async function fallback({ title, body }: NotificationInput): Promise<Result<null>> {
    if (deps.platform !== 'darwin') return fail(BLOCKED_MESSAGE);
    try {
      await deps.runOsascript([...OSASCRIPT_ARGS, title, body]);
      return ok(null);
    } catch (error: unknown) {
      if (error instanceof Error) return fail(BLOCKED_MESSAGE);
      throw error;
    }
  }

  return async function notify(input: NotificationInput): Promise<Result<null>> {
    if (!deps.isSupported()) return fail(UNSUPPORTED_MESSAGE);
    const nativeError = await deps.showNative(input);
    return nativeError === null ? ok(null) : fallback(input);
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
