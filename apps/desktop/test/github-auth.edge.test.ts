import { describe, expect, test } from 'vitest';
import {
  parseDeviceLogin,
  parseGithubStatus,
  redactSecrets,
  safeFailureMessage,
} from '../src/main/github-auth.js';
import { LOGIN_OUTPUT, nextProcess, setupGithub } from './github-auth-fixtures.js';

const TOKEN = `gho_${'a'.repeat(36)}`;

describe('garbage output', () => {
  test('status parsing never throws and reports logged out', () => {
    for (const output of ['', '\u0000\u0001garbage', 'Logged in', '✓ ✓ ✓']) {
      expect(parseGithubStatus({ code: 0, output })).toEqual({ loggedIn: false, user: null });
    }
    expect(parseGithubStatus({ code: null, output: 'Logged in to github.com account a' })).toEqual({
      loggedIn: false,
      user: null,
    });
  });

  test('device parsing returns null when no code is present', () => {
    expect(parseDeviceLogin('')).toBeNull();
    expect(parseDeviceLogin('hello world 1234-5678 abcd-efgh')).toBeNull();
  });

  test('device parsing strips ANSI sequences and falls back to the default URL', () => {
    expect(parseDeviceLogin('\u001b[1mWXYZ-9876\u001b[0m')).toEqual({
      code: 'WXYZ-9876',
      url: 'https://github.com/login/device',
    });
  });

  test('the multi-account status picks the active account', () => {
    const output = [
      'github.com',
      '  ✓ Logged in to github.com account old (keyring)',
      '  - Active account: false',
      '  ✓ Logged in to github.com account current (keyring)',
      '  - Active account: true',
    ].join('\n');
    expect(parseGithubStatus({ code: 0, output }).user).toBe('current');
  });
});

describe('login failures', () => {
  test('a non-zero exit emits failed with a short message', async () => {
    const { auth, processes, events } = setupGithub();
    await auth.startLogin();
    const login = await nextProcess(processes, 0);
    login.output('something went wrong\nHTTP 500: server error\n');
    login.exit(1);
    expect(events).toEqual([{ type: 'failed', message: 'HTTP 500: server error' }]);
  });

  test('a process that never prints a code emits no code-ready event', async () => {
    const { auth, processes, events } = setupGithub();
    await auth.startLogin();
    const login = await nextProcess(processes, 0);
    login.output('Waiting...\nstill nothing\n');
    login.exit(1);
    expect(events.map((event) => event.type)).toEqual(['failed']);
  });

  test('a spawn error emits failed', async () => {
    const { auth, processes, events } = setupGithub();
    await auth.startLogin();
    (await nextProcess(processes, 0)).fail(new Error('spawn gh EACCES'));
    expect(events).toEqual([{ type: 'failed', message: 'spawn gh EACCES' }]);
  });

  test('the login times out and kills gh', async () => {
    const { auth, processes, events } = setupGithub({ loginTimeoutMs: 10 });
    await auth.startLogin();
    const login = await nextProcess(processes, 0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(login.killed).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['failed']);
  });

  test('gh missing makes startLogin fail without spawning', async () => {
    const { auth, processes } = setupGithub({ gh: null });
    const result = await auth.startLogin();
    expect(result.ok).toBe(false);
    expect(processes).toHaveLength(0);
  });
});

describe('concurrency and cancel', () => {
  test('a second start while one login runs is rejected', async () => {
    const { auth, processes } = setupGithub();
    await expect(auth.startLogin()).resolves.toEqual({ ok: true, value: null });
    const second = await auth.startLogin();
    expect(second.ok).toBe(false);
    expect(processes).toHaveLength(1);
  });

  test('starting again works after the first login ends', async () => {
    const { auth, processes } = setupGithub();
    await auth.startLogin();
    (await nextProcess(processes, 0)).exit(0);
    await expect(auth.startLogin()).resolves.toEqual({ ok: true, value: null });
    expect(processes).toHaveLength(2);
  });

  test('cancel when idle does nothing', async () => {
    const { auth, processes, events } = setupGithub();
    expect(auth.cancelLogin()).toBe(false);
    expect(processes).toHaveLength(0);
    expect(events).toEqual([]);
  });

  test('logout is refused while a login runs', async () => {
    const { auth } = setupGithub();
    await auth.startLogin();
    const result = await auth.logout();
    expect(result.ok).toBe(false);
  });
});

describe('token safety', () => {
  test('redactSecrets hides token-shaped strings', () => {
    expect(redactSecrets(`token ${TOKEN} end`)).toBe('token [oculto] end');
    expect(redactSecrets('github_pat_' + 'A1b2'.repeat(10))).toBe('[oculto]');
    expect(safeFailureMessage(`error with ${TOKEN}`, 'x')).not.toContain(TOKEN);
  });

  test('output containing a token is never forwarded to the renderer', async () => {
    const { auth, processes, events } = setupGithub();
    await auth.startLogin();
    const login = await nextProcess(processes, 0);
    login.output(`${LOGIN_OUTPUT}\n! Token: ${TOKEN}\n`);
    login.output(`failed to use ${TOKEN}`);
    login.exit(1);
    expect(events.map((event) => event.type)).toEqual(['code-ready', 'failed']);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  test('a token in the status output never appears in the parsed status', () => {
    const status = parseGithubStatus({
      code: 0,
      output: `  ✓ Logged in to github.com account octocat (keyring)\n  - Token: ${TOKEN}\n`,
    });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  test('a token in the logout failure is redacted from the result', async () => {
    const { auth, processes } = setupGithub();
    const pending = auth.logout();
    (await nextProcess(processes, 0)).exit(0);
    (await nextProcess(processes, 1)).exit(1);
    const logout = await nextProcess(processes, 2);
    logout.output(`cannot revoke ${TOKEN}`);
    logout.exit(1);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
