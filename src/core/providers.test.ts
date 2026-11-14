import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { beginForcedReauth, isProviderId, providers, readAccountEmail } from './providers.js';
import type { CommandRunner } from './providers.js';

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'inova-provider-'));
});

function fakeRunner(result: Awaited<ReturnType<CommandRunner['run']>>): {
  runner: CommandRunner;
  envs: NodeJS.ProcessEnv[];
} {
  const envs: NodeJS.ProcessEnv[] = [];
  return {
    envs,
    runner: {
      run: (cmd) => {
        envs.push(cmd.env);
        return Promise.resolve(result);
      },
    },
  };
}

describe('providers', () => {
  it('claude status parses loggedIn true', async () => {
    const { runner, envs } = fakeRunner({ exitCode: 0, stdout: '{"loggedIn":true}' });
    const status = await providers.claude.checkStatus({ homeDir, env: {}, runner });
    expect(status).toBe('logged-in');
    expect(envs[0]?.['CLAUDE_CONFIG_DIR']).toBe(homeDir);
  });

  it('claude status parses loggedIn false even on non-zero exit', async () => {
    const { runner } = fakeRunner({ exitCode: 1, stdout: '{"loggedIn":false}' });
    expect(await providers.claude.checkStatus({ homeDir, env: {}, runner })).toBe('logged-out');
  });

  it('claude status returns unknown on non-JSON output', async () => {
    const { runner } = fakeRunner({ exitCode: 0, stdout: 'not json' });
    expect(await providers.claude.checkStatus({ homeDir, env: {}, runner })).toBe('unknown');
  });

  it('codex status maps exit code', async () => {
    const ok = fakeRunner({ exitCode: 0, stdout: '' });
    const bad = fakeRunner({ exitCode: 1, stdout: '' });
    expect(await providers.codex.checkStatus({ homeDir, env: {}, runner: ok.runner })).toBe(
      'logged-in',
    );
    expect(await providers.codex.checkStatus({ homeDir, env: {}, runner: bad.runner })).toBe(
      'logged-out',
    );
    expect(ok.envs[0]?.['CODEX_HOME']).toBe(homeDir);
  });

  it('codex and claude status are unknown when the runner reports exit code -1', async () => {
    const { runner } = fakeRunner({ exitCode: -1, stdout: '' });
    expect(await providers.codex.checkStatus({ homeDir, env: {}, runner })).toBe('unknown');
    expect(await providers.claude.checkStatus({ homeDir, env: {}, runner })).toBe('unknown');
  });

  it('status returns binary-missing when runner reports notFound', async () => {
    const { runner } = fakeRunner({ notFound: true });
    for (const adapter of Object.values(providers)) {
      expect(await adapter.checkStatus({ homeDir, env: {}, runner })).toBe('binary-missing');
    }
  });

  it('gemini status is logged-in only when the account oauth token file has content', async () => {
    const { runner, envs } = fakeRunner({ exitCode: 0, stdout: '' });
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-out');
    expect(envs[0]?.['HOME']).toBe(homeDir);
    const stateDir = join(homeDir, '.gemini', 'antigravity-cli');
    const cacheDir = join(stateDir, 'cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(stateDir, 'jetski_state.pbtxt'),
      'agent_onboarding_completed:  AGENT_ONBOARDING_STATE_COMPLETED\n',
    );
    await writeFile(
      join(cacheDir, 'onboarding.json'),
      JSON.stringify({ onboardingComplete: true }),
    );
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-out');

    await writeFile(join(stateDir, 'antigravity-oauth-token'), '  \n');
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-out');

    await writeFile(join(stateDir, 'antigravity-oauth-token'), 'tok-123');
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-in');
  });

  describe('beginForcedReauth', () => {
    const tokenPath = (): string =>
      join(homeDir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

    async function writeToken(content: string): Promise<void> {
      await mkdir(join(homeDir, '.gemini', 'antigravity-cli'), { recursive: true });
      await writeFile(tokenPath(), content);
    }

    async function readTokenOrNull(): Promise<string | null> {
      try {
        return await readFile(tokenPath(), 'utf8');
      } catch {
        return null;
      }
    }

    it('moves the gemini token aside and restores it when no new token is written', async () => {
      await writeToken('old-token');
      const finish = await beginForcedReauth({ provider: 'gemini', homeDir });
      expect(await readTokenOrNull()).toBeNull();
      await finish();
      expect(await readTokenOrNull()).toBe('old-token');
    });

    it('keeps the new gemini token and drops the old one after a successful login', async () => {
      await writeToken('old-token');
      const finish = await beginForcedReauth({ provider: 'gemini', homeDir });
      await writeToken('new-token');
      await finish();
      expect(await readTokenOrNull()).toBe('new-token');
      await finish();
      expect(await readTokenOrNull()).toBe('new-token');
    });

    it('restores a token left aside by an interrupted reauth', async () => {
      await writeToken('old-token');
      await beginForcedReauth({ provider: 'gemini', homeDir });
      const finish = await beginForcedReauth({ provider: 'gemini', homeDir });
      await finish();
      expect(await readTokenOrNull()).toBe('old-token');
    });

    it('does not touch credentials of other providers', async () => {
      await writeToken('old-token');
      const finish = await beginForcedReauth({ provider: 'claude', homeDir });
      expect(await readTokenOrNull()).toBe('old-token');
      await finish();
      expect(await readTokenOrNull()).toBe('old-token');
    });
  });

  it('gemini status is unknown when state read fails with a non-ENOENT error', async () => {
    const { runner } = fakeRunner({ exitCode: 0, stdout: '' });
    await writeFile(join(homeDir, '.gemini'), '');
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('unknown');
  });

  it('gemini status is unknown when the runner reports exit code -1', async () => {
    const { runner } = fakeRunner({ exitCode: -1, stdout: '' });
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('unknown');
  });

  it('codex initHome writes file credential store and keeps existing config.toml', async () => {
    await providers.codex.initHome(homeDir);
    const file = join(homeDir, 'config.toml');
    expect(await readFile(file, 'utf8')).toBe('cli_auth_credentials_store = "file"\n');
    await writeFile(file, 'custom = 1\n');
    await providers.codex.initHome(homeDir);
    expect(await readFile(file, 'utf8')).toBe('custom = 1\n');
  });

  it('claude prepareLaunch marks onboarding done and keeps other keys', async () => {
    const file = join(homeDir, '.claude.json');
    await writeFile(file, JSON.stringify({ userID: 'u1', nested: { a: 1 } }));
    await providers.claude.prepareLaunch(homeDir);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      userID: 'u1',
      nested: { a: 1 },
      hasCompletedOnboarding: true,
    });
  });

  it('claude prepareLaunch creates nothing when the account never logged in', async () => {
    await providers.claude.prepareLaunch(homeDir);
    await expect(readFile(join(homeDir, '.claude.json'))).rejects.toThrow(/ENOENT/);
  });

  it('claude prepareLaunch leaves an onboarded file byte for byte', async () => {
    const file = join(homeDir, '.claude.json');
    const original = '{"hasCompletedOnboarding":true,  "x":1}';
    await writeFile(file, original);
    await providers.claude.prepareLaunch(homeDir);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('codex prepareLaunch does not touch the home', async () => {
    await providers.codex.prepareLaunch(homeDir);
    await expect(readFile(join(homeDir, '.claude.json'))).rejects.toThrow(/ENOENT/);
  });

  it('gemini prepareLaunch symlinks global configs without touching .gemini or removing targets', async () => {
    const realHome = await mkdtemp(join(tmpdir(), 'inova-real-home-'));
    await writeFile(join(realHome, '.gitconfig'), '[user]\nname = Test\n');
    await mkdir(join(realHome, '.config', 'gh'), { recursive: true });
    await writeFile(join(realHome, '.config', 'gh', 'hosts.yml'), 'github.com:\n');
    await mkdir(join(realHome, '.gemini'), { recursive: true });
    await writeFile(join(realHome, '.gemini', 'secret'), 'do-not-link');
    await writeFile(join(homeDir, '.gitconfig'), 'account-override');

    await providers.gemini.prepareLaunch(homeDir, realHome);

    expect(await readFile(join(homeDir, '.gitconfig'), 'utf8')).toBe('account-override');
    expect((await lstat(join(homeDir, '.gitconfig'))).isSymbolicLink()).toBe(false);
    expect((await lstat(join(homeDir, '.config', 'gh'))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(homeDir, '.config', 'gh', 'hosts.yml'), 'utf8')).toBe(
      'github.com:\n',
    );
    await expect(lstat(join(homeDir, '.npmrc'))).rejects.toThrow(/ENOENT/);
    await expect(lstat(join(homeDir, '.gemini'))).rejects.toThrow(/ENOENT/);

    await rm(homeDir, { recursive: true, force: true });
    expect(await readFile(join(realHome, '.config', 'gh', 'hosts.yml'), 'utf8')).toBe(
      'github.com:\n',
    );
  });

  it('isProviderId accepts only known providers', () => {
    for (const id of [
      'claude',
      'codex',
      'gemini',
      'deepseek',
      'kimi',
      'grok',
      'qwen',
      'opencode',
    ]) {
      expect(isProviderId(id)).toBe(true);
    }
    expect(isProviderId('other')).toBe(false);
  });

  it('file-backed adapters detect credentials and emails inside isolated homes', async () => {
    const { runner } = fakeRunner({ exitCode: 0, stdout: '1.0.0' });
    const home = async (id: string) => {
      const dir = join(homeDir, id);
      await mkdir(dir, { recursive: true });
      return dir;
    };

    const dsHome = await home('deepseek');
    expect(await providers.deepseek.checkStatus({ homeDir: dsHome, env: {}, runner })).toBe(
      'logged-out',
    );
    await writeFile(join(dsHome, '.credentials.yaml'), 'token: ds-key\n');
    expect(await providers.deepseek.checkStatus({ homeDir: dsHome, env: {}, runner })).toBe(
      'logged-in',
    );

    const kmHome = await home('kimi');
    expect(await providers.kimi.checkStatus({ homeDir: kmHome, env: {}, runner })).toBe(
      'logged-out',
    );
    await mkdir(join(kmHome, 'credentials'), { recursive: true });
    await writeFile(
      join(kmHome, 'credentials', 'kimi-code.json'),
      JSON.stringify({ access_token: 'km', email: 'kimi@example.com' }),
    );
    expect(await providers.kimi.checkStatus({ homeDir: kmHome, env: {}, runner })).toBe(
      'logged-in',
    );
    expect(await readAccountEmail({ provider: 'kimi', homeDir: kmHome })).toBe('kimi@example.com');

    const gkHome = await home('grok');
    expect(await providers.grok.checkStatus({ homeDir: gkHome, env: {}, runner })).toBe(
      'logged-out',
    );
    await writeFile(
      join(gkHome, 'auth.json'),
      JSON.stringify({ xai_token: 'gk', user: { email: 'grok@example.com' } }),
    );
    expect(await providers.grok.checkStatus({ homeDir: gkHome, env: {}, runner })).toBe(
      'logged-in',
    );
    expect(await readAccountEmail({ provider: 'grok', homeDir: gkHome })).toBe('grok@example.com');

    const qwHome = await home('qwen');
    expect(await providers.qwen.checkStatus({ homeDir: qwHome, env: {}, runner })).toBe(
      'logged-out',
    );
    await mkdir(join(qwHome, '.qwen'), { recursive: true });
    await writeFile(
      join(qwHome, '.qwen', 'oauth_creds.json'),
      JSON.stringify({ access_token: 'qw', email: 'qwen@example.com' }),
    );
    expect(await providers.qwen.checkStatus({ homeDir: qwHome, env: {}, runner })).toBe(
      'logged-in',
    );
    expect(await readAccountEmail({ provider: 'qwen', homeDir: qwHome })).toBe('qwen@example.com');

    const ocHome = await home('opencode');
    await mkdir(join(ocHome, 'opencode'), { recursive: true });
    await writeFile(join(ocHome, 'opencode', 'auth.json'), JSON.stringify({}));
    expect(await providers.opencode.checkStatus({ homeDir: ocHome, env: {}, runner })).toBe(
      'logged-out',
    );
    await writeFile(
      join(ocHome, 'opencode', 'auth.json'),
      JSON.stringify({ anthropic: { type: 'oauth', email: 'oc@example.com' } }),
    );
    expect(await providers.opencode.checkStatus({ homeDir: ocHome, env: {}, runner })).toBe(
      'logged-in',
    );
    expect(await readAccountEmail({ provider: 'opencode', homeDir: ocHome })).toBe(
      'oc@example.com',
    );
  });

  it('readAccountEmail extracts connected email for claude, codex, and gemini', async () => {
    expect(await readAccountEmail({ provider: 'claude', homeDir })).toBeNull();
    expect(await readAccountEmail({ provider: 'codex', homeDir })).toBeNull();
    expect(await readAccountEmail({ provider: 'gemini', homeDir })).toBeNull();

    await writeFile(
      join(homeDir, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: ' claude@example.com ' } }),
    );
    expect(await readAccountEmail({ provider: 'claude', homeDir })).toBe('claude@example.com');

    const jwtPayload = Buffer.from(JSON.stringify({ email: 'codex@example.com' })).toString(
      'base64url',
    );
    await writeFile(
      join(homeDir, 'auth.json'),
      JSON.stringify({ tokens: { id_token: `hdr.${jwtPayload}.sig` } }),
    );
    expect(await readAccountEmail({ provider: 'codex', homeDir })).toBe('codex@example.com');

    await mkdir(join(homeDir, '.gemini', 'antigravity-cli'), { recursive: true });
    await writeFile(
      join(homeDir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      JSON.stringify({ token: 'tok', auth_method: 'oauth', id_token_email: 'agy@example.com' }),
    );
    expect(await readAccountEmail({ provider: 'gemini', homeDir })).toBe('agy@example.com');

    await writeFile(join(homeDir, '.claude.json'), '{broken-json');
    expect(await readAccountEmail({ provider: 'claude', homeDir })).toBeNull();
  });
});
