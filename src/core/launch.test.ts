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
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
  ];
  const geminiBase = [
    '--prompt=hi',
    '--output-format',
    'stream-json',
    '--mode',
    'accept-edits',
    '--dangerously-skip-permissions',
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
      '--',
      'hi',
    ]);
    expect(argsFor(claudeAccount, { mode: 'resume', providerSessionId: 'p1' })).toEqual([
      ...claudeBase,
      '--resume',
      'p1',
      '--',
      'hi',
    ]);
    expect(
      argsFor(claudeAccount, { mode: 'fork', parentProviderSessionId: 'p1', sessionId: 's2' }),
    ).toEqual([
      ...claudeBase,
      '--resume',
      'p1',
      '--fork-session',
      '--session-id',
      's2',
      '--',
      'hi',
    ]);
  });

  it('builds gemini args for each mode', () => {
    expect(argsFor(geminiAccount, { mode: 'new', sessionId: 's1' })).toEqual(geminiBase);
    expect(argsFor(geminiAccount, { mode: 'resume', providerSessionId: 'p1' })).toEqual([
      ...geminiBase,
      '--conversation',
      'p1',
    ]);
    expect(
      argsFor(geminiAccount, { mode: 'fork', parentProviderSessionId: 'p1', sessionId: 's2' }),
    ).toEqual(geminiBase);
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

  it.each([
    '--version',
    '--dangerously-skip-permissions',
    '--print',
    'a=b',
    'line1\n--flag\nline3',
  ])('passes the claude prompt %j after the -- terminator', (prompt) => {
    const args = argsFor(claudeAccount, { mode: 'new', sessionId: 's1' }, prompt);
    expect(args.slice(-2)).toEqual(['--', prompt]);
    expect(args.slice(0, -2)).not.toContain(prompt);
    expect(args[0]).toBe('-p');
  });

  it.each(['-y', '--print', 'a=b', 'line1\n--flag\nline3', ''])(
    'binds the gemini prompt %j inside one --prompt= argument',
    (prompt) => {
      const args = argsFor(geminiAccount, { mode: 'new', sessionId: 's1' }, prompt);
      expect(args[0]).toBe(`--prompt=${prompt}`);
      expect(args.filter((arg) => arg === prompt && prompt !== '')).toEqual([]);
    },
  );

  it('isolates gemini with HOME and strips Google keys', () => {
    const spec = buildChatTurn({
      account: geminiAccount,
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'new', sessionId: 's1' },
      baseEnv: {
        HOME: '/real/home',
        GEMINI_API_KEY: 'gk',
        GOOGLE_API_KEY: 'ak',
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'proj',
        GOOGLE_CLOUD_PROJECT_ID: 'proj-id',
        PATH: '/bin',
      },
    });
    expect(spec.command).toBe('agy');
    expect(spec.env).toEqual({ HOME: '/h/gemini', PATH: '/bin' });
  });

  it('passes model and effort flags for claude, gemini, and codex', () => {
    const claudeArgs = buildChatTurn({
      account: claudeAccount,
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'new', sessionId: 's1' },
      baseEnv,
      model: 'opus',
      effort: 'max',
    }).args;
    expect(claudeArgs).toEqual([
      ...claudeBase,
      '--model',
      'opus',
      '--effort',
      'max',
      '--session-id',
      's1',
      '--',
      'hi',
    ]);

    const geminiArgs = buildChatTurn({
      account: geminiAccount,
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p1' },
      baseEnv,
      model: 'gemini-4-hydrogen-high',
      effort: 'xhigh',
    }).args;
    expect(geminiArgs).toEqual([
      ...geminiBase,
      '--model',
      'gemini-4-hydrogen-high',
      '--effort',
      'xhigh',
      '--conversation',
      'p1',
    ]);

    const codexArgs = buildChatTurn({
      account: codexAccount,
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p1' },
      baseEnv,
      model: 'gpt-5.3-codex',
      effort: 'high',
    }).args;
    expect(codexArgs).toEqual([
      'exec',
      'resume',
      'p1',
      ...codexFlags,
      '--model',
      'gpt-5.3-codex',
      '-c',
      'model_reasoning_effort="high"',
      'hi',
    ]);
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

  it('builds args and isolated env for deepseek, kimi, grok, qwen, and opencode', () => {
    const extraBase = {
      DEEPSEEK_API_KEY: 'ds',
      MOONSHOT_API_KEY: 'km',
      XAI_API_KEY: 'gk',
      DASHSCOPE_API_KEY: 'qw',
      OPENCODE_API_KEY: 'oc',
      PATH: '/bin',
    };
    const ds = buildChatTurn({
      account: { ...claudeAccount, provider: 'deepseek', homeDir: '/h/ds' },
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'new', sessionId: 's1' },
      baseEnv: extraBase,
      model: 'deepseek-reasoner',
    });
    expect(ds.command).toBe('dsh');
    expect(ds.env['DSH_HOME']).toBe('/h/ds');
    expect(ds.env['DEEPSEEK_API_KEY']).toBeUndefined();
    expect(ds.args).toContain('--profile');
    expect(ds.args).toContain('--jsonl');

    const km = buildChatTurn({
      account: { ...claudeAccount, provider: 'kimi', homeDir: '/h/km' },
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p-km' },
      baseEnv: extraBase,
      model: 'kimi-k2.5',
    });
    expect(km.command).toBe('kimi');
    expect(km.env['KIMI_CODE_HOME']).toBe('/h/km');
    expect(km.args).toEqual([
      '--print',
      '--prompt',
      'hi',
      '--output-format',
      'stream-json',
      '--yolo',
      '-m',
      'kimi-k2.5',
      '-S',
      'p-km',
    ]);

    const gk = buildChatTurn({
      account: { ...claudeAccount, provider: 'grok', homeDir: '/h/gk' },
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p-gk' },
      baseEnv: extraBase,
      model: 'grok-4',
    });
    expect(gk.command).toBe('grok');
    expect(gk.env['GROK_HOME']).toBe('/h/gk');
    expect(gk.args).toContain('streaming-json');
    expect(gk.args).toContain('-r');

    const qw = buildChatTurn({
      account: { ...claudeAccount, provider: 'qwen', homeDir: '/h/qw' },
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p-qw' },
      baseEnv: extraBase,
      model: 'qwen3-coder-plus',
    });
    expect(qw.command).toBe('qwen');
    expect(qw.env['HOME']).toBe('/h/qw');
    expect(qw.args).toContain('--approval-mode');
    expect(qw.args).toContain('--resume');

    const oc = buildChatTurn({
      account: { ...claudeAccount, provider: 'opencode', homeDir: '/h/oc' },
      cwd: '/proj',
      prompt: 'hi',
      turn: { mode: 'resume', providerSessionId: 'p-oc' },
      baseEnv: extraBase,
      model: 'openai/gpt-5',
    });
    expect(oc.command).toBe('opencode');
    expect(oc.env['XDG_DATA_HOME']).toBe('/h/oc');
    expect(oc.args).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      'openai/gpt-5',
      '-s',
      'p-oc',
      'hi',
    ]);
  });

  it('maps execution mode flags across all eight providers', () => {
    const cases: Array<{
      provider: Account['provider'];
      mode: NonNullable<Parameters<typeof buildChatTurn>[0]['executionMode']>;
      expectedArgsSubset: string[];
      forbiddenArgs?: string[];
    }> = [
      { provider: 'claude', mode: 'auto', expectedArgsSubset: ['--permission-mode', 'auto'] },
      {
        provider: 'claude',
        mode: 'manual',
        expectedArgsSubset: ['--permission-mode', 'manual', '--permission-prompts', 'none'],
      },
      {
        provider: 'claude',
        mode: 'accept-edits',
        expectedArgsSubset: ['--permission-mode', 'acceptEdits'],
      },
      { provider: 'claude', mode: 'plan', expectedArgsSubset: ['--permission-mode', 'plan'] },
      {
        provider: 'claude',
        mode: 'bypass',
        expectedArgsSubset: [
          '--permission-mode',
          'bypassPermissions',
          '--dangerously-skip-permissions',
        ],
      },
      {
        provider: 'gemini',
        mode: 'manual',
        expectedArgsSubset: ['--mode', 'accept-edits', '--sandbox'],
        forbiddenArgs: ['--dangerously-skip-permissions'],
      },
      {
        provider: 'gemini',
        mode: 'accept-edits',
        expectedArgsSubset: ['--mode', 'accept-edits'],
        forbiddenArgs: ['--dangerously-skip-permissions', '--sandbox'],
      },
      { provider: 'gemini', mode: 'auto', expectedArgsSubset: ['--mode', 'auto'] },
      { provider: 'gemini', mode: 'plan', expectedArgsSubset: ['--mode', 'plan'] },
      {
        provider: 'gemini',
        mode: 'bypass',
        expectedArgsSubset: ['--mode', 'accept-edits', '--dangerously-skip-permissions'],
      },
      { provider: 'codex', mode: 'read-only', expectedArgsSubset: ['--sandbox', 'read-only'] },
      {
        provider: 'codex',
        mode: 'accept-edits',
        expectedArgsSubset: ['--sandbox', 'workspace-write'],
      },
      {
        provider: 'codex',
        mode: 'auto',
        expectedArgsSubset: ['--sandbox', 'workspace-write', '--approve-for-me'],
      },
      {
        provider: 'codex',
        mode: 'bypass',
        expectedArgsSubset: ['--dangerously-bypass-approvals-and-sandbox'],
        forbiddenArgs: ['--sandbox'],
      },
      { provider: 'qwen', mode: 'plan', expectedArgsSubset: ['--approval-mode', 'plan'] },
      { provider: 'qwen', mode: 'manual', expectedArgsSubset: ['--approval-mode', 'default'] },
      {
        provider: 'qwen',
        mode: 'accept-edits',
        expectedArgsSubset: ['--approval-mode', 'auto-edit'],
      },
      { provider: 'qwen', mode: 'bypass', expectedArgsSubset: ['--approval-mode', 'yolo'] },
      {
        provider: 'kimi',
        mode: 'manual',
        expectedArgsSubset: [],
        forbiddenArgs: ['--yolo', '--auto'],
      },
      { provider: 'kimi', mode: 'accept-edits', expectedArgsSubset: ['--yolo'] },
      { provider: 'kimi', mode: 'bypass', expectedArgsSubset: ['--auto'] },
      {
        provider: 'grok',
        mode: 'manual',
        expectedArgsSubset: [],
        forbiddenArgs: ['--always-approve'],
      },
      { provider: 'grok', mode: 'bypass', expectedArgsSubset: ['--always-approve'] },
      { provider: 'opencode', mode: 'manual', expectedArgsSubset: [], forbiddenArgs: ['--auto'] },
      { provider: 'opencode', mode: 'auto', expectedArgsSubset: ['--auto'] },
      { provider: 'deepseek', mode: 'read-only', expectedArgsSubset: ['--mode', 'read-only'] },
      {
        provider: 'deepseek',
        mode: 'accept-edits',
        expectedArgsSubset: ['--mode', 'workspace-write'],
      },
    ];

    for (const item of cases) {
      const spec = buildChatTurn({
        account: { ...claudeAccount, provider: item.provider, homeDir: `/h/${item.provider}` },
        cwd: '/proj',
        prompt: 'hi',
        turn: { mode: 'new', sessionId: 's1' },
        baseEnv,
        executionMode: item.mode,
      });
      for (const token of item.expectedArgsSubset) {
        expect(spec.args).toContain(token);
      }
      for (const forbidden of item.forbiddenArgs ?? []) {
        expect(spec.args).not.toContain(forbidden);
      }
    }
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
