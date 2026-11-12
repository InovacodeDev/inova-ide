import { describe, expect, it } from 'vitest';
import { buildLaunch, buildLogin } from './launch.js';
import type { Account } from './types.js';

const claudeAccount: Account = {
  id: 'id1',
  provider: 'claude',
  label: 'work',
  homeDir: '/h/claude',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('buildLaunch', () => {
  it('sets isolation var and strips provider api keys', () => {
    const spec = buildLaunch({
      account: claudeAccount,
      cwd: '/proj',
      args: ['--resume'],
      baseEnv: { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', PATH: '/bin' },
    });
    expect(spec.command).toBe('claude');
    expect(spec.args).toEqual(['--resume']);
    expect(spec.cwd).toBe('/proj');
    expect(spec.env).toEqual({ CLAUDE_CONFIG_DIR: '/h/claude', PATH: '/bin' });
  });

  it('does not mutate baseEnv', () => {
    const baseEnv = { ANTHROPIC_API_KEY: 'k', PATH: '/bin' };
    buildLaunch({ account: claudeAccount, cwd: '/proj', args: [], baseEnv });
    expect(baseEnv).toEqual({ ANTHROPIC_API_KEY: 'k', PATH: '/bin' });
  });

  it('for codex strips OPENAI_API_KEY but keeps ANTHROPIC_API_KEY', () => {
    const spec = buildLaunch({
      account: { ...claudeAccount, provider: 'codex', homeDir: '/h/codex' },
      cwd: '/proj',
      args: [],
      baseEnv: { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' },
    });
    expect(spec.env).toEqual({ CODEX_HOME: '/h/codex', ANTHROPIC_API_KEY: 'a' });
  });
});

describe('buildLogin', () => {
  it('uses provider loginArgs and the account home as cwd', () => {
    const spec = buildLogin({ account: claudeAccount, baseEnv: { ANTHROPIC_API_KEY: 'k' } });
    expect(spec).toEqual({
      command: 'claude',
      args: ['auth', 'login'],
      cwd: '/h/claude',
      env: { CLAUDE_CONFIG_DIR: '/h/claude' },
    });
  });
});
