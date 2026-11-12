import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { isProviderId, providers } from './providers.js';
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

  it('gemini status is logged-in only when oauth_creds.json exists', async () => {
    const { runner } = fakeRunner({ exitCode: 0, stdout: '' });
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-out');
    await mkdir(join(homeDir, '.gemini'));
    await writeFile(join(homeDir, '.gemini', 'oauth_creds.json'), '');
    expect(await providers.gemini.checkStatus({ homeDir, env: {}, runner })).toBe('logged-in');
  });

  it('gemini status is unknown when access fails with a non-ENOENT error', async () => {
    const { runner } = fakeRunner({ exitCode: 0, stdout: '' });
    await writeFile(join(homeDir, '.gemini'), '');
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

  it('isProviderId accepts only known providers', () => {
    expect(isProviderId('claude')).toBe(true);
    expect(isProviderId('other')).toBe(false);
  });
});
