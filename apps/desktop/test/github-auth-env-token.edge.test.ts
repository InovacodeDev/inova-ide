import { describe, expect, test } from 'vitest';
import type { GithubLoginEvent } from '../src/shared/api.js';
import {
  GH_ENV_TOKEN_VARS,
  createGithubAuth,
  envTokenVarIn,
  parseGithubStatus,
  withoutGhEnvTokens,
} from '../src/main/github-auth.js';
import { FakeGithubProcess, nextProcess } from './github-auth-fixtures.js';

const SECRET = `ghp_${'q'.repeat(36)}`;

const ENV_STATUS = [
  'github.com',
  '  ✓ Logged in to github.com account octocat (GH_TOKEN)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  '  - Token: ghp_************************************',
  "  - Token scopes: 'repo'",
  '',
].join('\n');

function setup(env: NodeJS.ProcessEnv) {
  const processes: FakeGithubProcess[] = [];
  const events: GithubLoginEvent[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const auth = createGithubAuth({
    findGh: async () => '/usr/bin/gh',
    getEnv: async () => env,
    spawn: ({ file, args, env: childEnv }) => {
      const process = new FakeGithubProcess(file, args);
      processes.push(process);
      envs.push(childEnv);
      return process;
    },
    emit: (event) => events.push(event),
  });
  return { auth, processes, events, envs };
}

describe('gh token from the environment', () => {
  test('the parser reports the env var as the token source', () => {
    expect(parseGithubStatus({ code: 0, output: ENV_STATUS })).toEqual({
      loggedIn: true,
      user: 'octocat',
      scopes: ['repo'],
      tokenSource: 'env',
      envTokenVar: 'GH_TOKEN',
    });
  });

  test('a keyring login has no token source', () => {
    const output = '  ✓ Logged in to github.com account a (keyring)\n  - Active account: true\n';
    expect(parseGithubStatus({ code: 0, output })).toEqual({ loggedIn: true, user: 'a' });
  });

  test.each(GH_ENV_TOKEN_VARS)('the parser recognizes %s', (name) => {
    const output = `  ✓ Logged in to github.com account a (${name})\n  - Active account: true\n`;
    expect(parseGithubStatus({ code: 0, output })).toMatchObject({
      tokenSource: 'env',
      envTokenVar: name,
    });
  });

  test('an unrelated parenthesis does not count as an env source', () => {
    const output = '  ✓ Logged in to github.com account a (MY_TOKEN)\n  - Active account: true\n';
    expect(parseGithubStatus({ code: 0, output })).not.toHaveProperty('tokenSource');
  });

  test('envTokenVarIn ignores empty values and withoutGhEnvTokens removes every variable', () => {
    expect(envTokenVarIn({ GH_TOKEN: '' })).toBeUndefined();
    expect(envTokenVarIn({ GITHUB_TOKEN: 'x' })).toBe('GITHUB_TOKEN');
    const stripped = withoutGhEnvTokens({
      PATH: '/bin',
      GH_TOKEN: 'a',
      GITHUB_TOKEN: 'b',
      GH_ENTERPRISE_TOKEN: 'c',
      GITHUB_ENTERPRISE_TOKEN: 'd',
    });
    expect(stripped).toEqual({ PATH: '/bin' });
  });

  test('startLogin spawns gh without the token variables and keeps the other variables', async () => {
    const { auth, processes, envs } = setup({
      PATH: '/usr/bin',
      GH_TOKEN: SECRET,
      GITHUB_TOKEN: SECRET,
      GH_ENTERPRISE_TOKEN: SECRET,
      GITHUB_ENTERPRISE_TOKEN: SECRET,
    });
    await auth.startLogin();
    await nextProcess(processes, 0);
    const env = envs[0] ?? {};
    for (const name of GH_ENV_TOKEN_VARS) expect(name in env).toBe(false);
    expect(env['PATH']).toBe('/usr/bin');
    expect(JSON.stringify(env)).not.toContain(SECRET);
    auth.dispose();
  });

  test('status keeps the env var for gh and reports the source without printing the token', async () => {
    const { auth, processes, envs } = setup({ PATH: '/usr/bin', GH_TOKEN: SECRET });
    const pending = auth.getStatus();
    const version = await nextProcess(processes, 0);
    version.output('gh version 2.0.0\n');
    version.exit(0);
    const status = await nextProcess(processes, 1);
    status.output(ENV_STATUS);
    status.exit(0);
    const result = await pending;
    expect(result).toMatchObject({
      installed: true,
      loggedIn: true,
      user: 'octocat',
      tokenSource: 'env',
      envTokenVar: 'GH_TOKEN',
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(envs[1]?.['GH_TOKEN']).toBe(SECRET);
  });

  test('status reports the env var even when gh says logged out', async () => {
    const { auth, processes } = setup({ PATH: '/usr/bin', GITHUB_TOKEN: SECRET });
    const pending = auth.getStatus();
    const version = await nextProcess(processes, 0);
    version.exit(0);
    const status = await nextProcess(processes, 1);
    status.output('The token in GITHUB_TOKEN is invalid.\n');
    status.exit(1);
    expect(await pending).toEqual({
      installed: true,
      loggedIn: false,
      user: null,
      envTokenVar: 'GITHUB_TOKEN',
    });
  });

  test('status without env tokens has no env fields', async () => {
    const { auth, processes } = setup({ PATH: '/usr/bin' });
    const pending = auth.getStatus();
    const version = await nextProcess(processes, 0);
    version.exit(0);
    const status = await nextProcess(processes, 1);
    status.exit(1);
    expect(await pending).toEqual({ installed: true, loggedIn: false, user: null });
  });

  test('logout runs gh without the token variables so the keyring account is removed', async () => {
    const { auth, processes, envs } = setup({ PATH: '/usr/bin', GH_TOKEN: SECRET });
    const pending = auth.logout();
    const version = await nextProcess(processes, 0);
    version.exit(0);
    const status = await nextProcess(processes, 1);
    status.output(
      '  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n',
    );
    status.exit(0);
    const logout = await nextProcess(processes, 2);
    logout.exit(0);
    expect(await pending).toEqual({ ok: true, value: null });
    for (const env of envs) expect('GH_TOKEN' in env).toBe(false);
  });
});
