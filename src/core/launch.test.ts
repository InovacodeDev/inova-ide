import { describe, expect, it } from 'vitest';
import { buildChatTurn, buildLaunch, buildLogin } from './launch.js';
import type { ChatTurn } from './launch.js';
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

describe('buildChatTurn', () => {
  const baseEnv = { ANTHROPIC_API_KEY: 'k', PATH: '/bin' };
  const claudeBase = [
    '-p',
    'hi',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
  ];
  const geminiBase = [
    '-p',
    'hi',
    '-o',
    'stream-json',
    '--approval-mode',
    'auto_edit',
    '--skip-trust',
  ];
  const codexFlags = ['--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
  const geminiAccount: Account = { ...claudeAccount, provider: 'gemini', homeDir: '/h/gemini' };
  const codexAccount: Account = { ...claudeAccount, provider: 'codex', homeDir: '/h/codex' };

  function argsFor(account: Account, turn: ChatTurn, prompt = 'hi'): string[] {
    return buildChatTurn({ account, cwd: '/proj', prompt, turn, baseEnv }).args;
  }

  it('builds claude args for each mode', () => {
    expect(argsFor(claudeAccount, { mode: 'new', sessionId: 's1' })).toEqual([
      ...claudeBase,
      '--session-id',
      's1',
    ]);
    expect(argsFor(claudeAccount, { mode: 'resume', providerSessionId: 'p1' })).toEqual([
      ...claudeBase,
      '--resume',
      'p1',
    ]);
    expect(
      argsFor(claudeAccount, { mode: 'fork', parentProviderSessionId: 'p1', sessionId: 's2' }),
    ).toEqual([...claudeBase, '--resume', 'p1', '--fork-session', '--session-id', 's2']);
  });

  it('builds gemini args for each mode', () => {
    expect(argsFor(geminiAccount, { mode: 'new', sessionId: 's1' })).toEqual([
      ...geminiBase,
      '--session-id',
      's1',
    ]);
    expect(argsFor(geminiAccount, { mode: 'resume', providerSessionId: 'p1' })).toEqual([
      ...geminiBase,
      '--resume',
      'p1',
    ]);
    expect(
      argsFor(geminiAccount, { mode: 'fork', parentProviderSessionId: 'p1', sessionId: 's2' }),
    ).toEqual([...geminiBase, '--session-id', 's2']);
  });

  it('builds codex args for each mode', () => {
    expect(argsFor(codexAccount, { mode: 'new', sessionId: 's1' })).toEqual([
      'exec',
      ...codexFlags,
      'hi',
    ]);
    expect(argsFor(codexAccount, { mode: 'resume', providerSessionId: 'p1' })).toEqual([
      'exec',
      'resume',
      'p1',
      ...codexFlags,
      'hi',
    ]);
    expect(
      argsFor(codexAccount, { mode: 'fork', parentProviderSessionId: 'p1', sessionId: 's2' }),
    ).toEqual(['exec', ...codexFlags, 'hi']);
  });

  it('separates a dash-leading codex prompt from flags', () => {
    expect(argsFor(codexAccount, { mode: 'new', sessionId: 's1' }, '--evil')).toEqual([
      'exec',
      ...codexFlags,
      '--',
      '--evil',
    ]);
  });

  it('keeps a dash-leading prompt as the -p value for claude', () => {
    const args = argsFor(claudeAccount, { mode: 'new', sessionId: 's1' }, '--evil');
    expect(args.slice(0, 2)).toEqual(['-p', '--evil']);
  });

  it('keeps env isolation and cwd', () => {
    const spec = buildChatTurn({
      account: claudeAccount,
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'new', sessionId: 's1' },
      baseEnv,
    });
    expect(spec.command).toBe('claude');
    expect(spec.cwd).toBe('/proj');
    expect(spec.env).toEqual({ CLAUDE_CONFIG_DIR: '/h/claude', PATH: '/bin' });
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
