import { expect, test, vi } from 'vitest';
import { createNotifier, type NotifierDeps } from '../src/main/notifications';

const input = { title: 'Sessão "a"', body: 'Terminou; $(rm -rf)' };

function setup(overrides: Partial<NotifierDeps> = {}) {
  const deps = {
    platform: 'darwin' as NodeJS.Platform,
    isSupported: vi.fn(() => true),
    showNative: vi.fn<NotifierDeps['showNative']>(async () => null),
    runOsascript: vi.fn<NotifierDeps['runOsascript']>(async () => undefined),
    ...overrides,
  };
  return { deps, notify: createNotifier(deps) };
}

test('a native notification that shows needs no fallback', async () => {
  const { deps, notify } = setup();
  expect(await notify(input)).toEqual({ ok: true, value: null });
  expect(deps.showNative).toHaveBeenCalledExactlyOnceWith(input);
  expect(deps.runOsascript).not.toHaveBeenCalled();
});

test('an unsupported system fails without trying to show', async () => {
  const { deps, notify } = setup({ isSupported: () => false });
  expect((await notify(input)).ok).toBe(false);
  expect(deps.showNative).not.toHaveBeenCalled();
});

test('macOS falls back to osascript with the text passed as arguments', async () => {
  const runOsascript = vi.fn<NotifierDeps['runOsascript']>(async () => undefined);
  const { notify } = setup({ showNative: async () => 'UNErrorDomain 1', runOsascript });
  expect(await notify(input)).toEqual({ ok: true, value: null });
  const args = runOsascript.mock.calls[0]?.[0] ?? [];
  expect(args.slice(-2)).toEqual([input.title, input.body]);
  expect(args.slice(0, -2).join(' ')).not.toContain(input.body);
});

test('a blocked notification reports the failure when the fallback also fails', async () => {
  const { notify } = setup({
    showNative: async () => 'UNErrorDomain 1',
    runOsascript: async () => {
      throw new Error('osascript failed');
    },
  });
  const result = await notify(input);
  expect(result.ok).toBe(false);
  expect(result.ok ? '' : result.message).toContain('bloqueou');
});

test('other platforms report a blocked notification without running osascript', async () => {
  const { deps, notify } = setup({ platform: 'win32', showNative: async () => 'denied' });
  expect((await notify(input)).ok).toBe(false);
  expect(deps.runOsascript).not.toHaveBeenCalled();
});
