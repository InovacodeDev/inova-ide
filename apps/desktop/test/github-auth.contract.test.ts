import { describe, expect, test } from 'vitest';
import {
  parseDeviceLogin,
  parseGithubStatus,
  spawnGithubProcess,
} from '../src/main/github-auth.js';
import {
  LOGIN_OUTPUT,
  STATUS_LOGGED_IN,
  nextProcess,
  setupGithub,
} from './github-auth-fixtures.js';

describe('parseGithubStatus', () => {
  test('parses a logged in account with scopes', () => {
    expect(parseGithubStatus({ code: 0, output: STATUS_LOGGED_IN })).toEqual({
      loggedIn: true,
      user: 'octocat',
      scopes: ['gist', 'read:org', 'repo'],
    });
  });

  test('parses the older "Logged in to github.com as" format', () => {
    const output = 'github.com\n  ✓ Logged in to github.com as hubot (oauth_token)\n';
    expect(parseGithubStatus({ code: 0, output })).toEqual({ loggedIn: true, user: 'hubot' });
  });

  test('reports logged out when gh exits with an error', () => {
    const output = 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n';
    expect(parseGithubStatus({ code: 1, output })).toEqual({ loggedIn: false, user: null });
  });

  test('exposes the spawn adapter used by the real app', () => {
    expect(typeof spawnGithubProcess).toBe('function');
  });
});

describe('parseDeviceLogin', () => {
  test('extracts the one-time code and the verification URL', () => {
    const output = `${LOGIN_OUTPUT}\nOpen https://github.com/login/device to continue`;
    expect(parseDeviceLogin(output)).toEqual({
      code: 'ABCD-1234',
      url: 'https://github.com/login/device',
    });
  });
});

describe('getStatus', () => {
  test('reports gh as not installed when the binary is missing', async () => {
    const { auth, processes } = setupGithub({ gh: null });
    await expect(auth.getStatus()).resolves.toEqual({
      installed: false,
      loggedIn: false,
      user: null,
    });
    expect(processes).toHaveLength(0);
  });

  test('runs gh --version and gh auth status for github.com', async () => {
    const { auth, processes } = setupGithub();
    const pending = auth.getStatus();
    const version = await nextProcess(processes, 0);
    expect(version.args).toEqual(['--version']);
    version.output('gh version 2.60.0\n');
    version.exit(0);
    const status = await nextProcess(processes, 1);
    expect(status.args).toEqual(['auth', 'status', '--hostname', 'github.com']);
    expect(status.args).not.toContain('--show-token');
    status.output(STATUS_LOGGED_IN);
    status.exit(0);
    await expect(pending).resolves.toEqual({
      installed: true,
      loggedIn: true,
      user: 'octocat',
      scopes: ['gist', 'read:org', 'repo'],
    });
  });

  test('reports installed but logged out', async () => {
    const { auth, processes } = setupGithub();
    const pending = auth.getStatus();
    (await nextProcess(processes, 0)).exit(0);
    const status = await nextProcess(processes, 1);
    status.output('You are not logged into any GitHub hosts.\n');
    status.exit(1);
    await expect(pending).resolves.toEqual({ installed: true, loggedIn: false, user: null });
  });

  test('reports not installed when spawning gh fails', async () => {
    const { auth, processes } = setupGithub();
    const pending = auth.getStatus();
    (await nextProcess(processes, 0)).fail(new Error('spawn gh ENOENT'));
    await expect(pending).resolves.toEqual({ installed: false, loggedIn: false, user: null });
  });
});

describe('login flow', () => {
  test('spawns gh auth login with the web flow, emits the code, then success', async () => {
    const { auth, processes, events } = setupGithub();
    await expect(auth.startLogin()).resolves.toEqual({ ok: true, value: null });
    const login = await nextProcess(processes, 0);
    expect(login.args).toEqual([
      'auth',
      'login',
      '--hostname',
      'github.com',
      '--git-protocol',
      'https',
      '--web',
      '--scopes',
      'repo,read:org',
    ]);
    login.output(LOGIN_OUTPUT);
    expect(events).toEqual([
      { type: 'code-ready', code: 'ABCD-1234', url: 'https://github.com/login/device' },
    ]);
    expect(login.writes).toEqual(['\n']);
    login.exit(0);
    expect(events).toEqual([
      { type: 'code-ready', code: 'ABCD-1234', url: 'https://github.com/login/device' },
      { type: 'succeeded' },
    ]);
  });

  test('cancel kills the process and emits nothing', async () => {
    const { auth, processes, events } = setupGithub();
    await auth.startLogin();
    const login = await nextProcess(processes, 0);
    expect(auth.cancelLogin()).toBe(true);
    expect(login.killed).toBe(true);
    login.exit(null);
    expect(events).toEqual([]);
  });

  test('logout runs gh auth logout and confirms with Y', async () => {
    const { auth, processes } = setupGithub();
    const pending = auth.logout();
    (await nextProcess(processes, 0)).exit(0);
    const status = await nextProcess(processes, 1);
    status.output(STATUS_LOGGED_IN);
    status.exit(0);
    const logout = await nextProcess(processes, 2);
    expect(logout.args).toEqual([
      'auth',
      'logout',
      '--hostname',
      'github.com',
      '--user',
      'octocat',
    ]);
    expect(logout.writes).toEqual(['Y\n']);
    logout.exit(0);
    await expect(pending).resolves.toEqual({ ok: true, value: null });
  });
});
