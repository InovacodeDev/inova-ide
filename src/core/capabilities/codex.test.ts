import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../providers.js';
import { codexCapabilities } from './codex.js';
import type { CapabilityContext } from './types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/capabilities/${name}`, import.meta.url), 'utf8');
}
type RunResult = Awaited<ReturnType<CommandRunner['run']>>;
type Overrides = Partial<Record<'mcp' | 'plugin', RunResult>>;

function runnerWith(overrides: Overrides): CommandRunner {
  return {
    run: async (cmd) => {
      if (cmd.args[0] === 'plugin') {
        return overrides.plugin ?? { exitCode: 0, stdout: fixture('codex-plugin-list.json') };
      }
      return overrides.mcp ?? { exitCode: 0, stdout: fixture('codex-mcp-list.json') };
    },
  };
}

function contextWith(input: {
  overrides?: Overrides;
  disabledCapabilities?: CapabilityContext['account']['disabledCapabilities'];
}): CapabilityContext {
  return {
    account: {
      id: 'acc-1',
      provider: 'codex',
      label: 'Codex',
      homeDir: '/nonexistent/acc',
      createdAt: '2026-01-01T00:00:00.000Z',
      disabledCapabilities: input.disabledCapabilities,
    },
    runner: runnerWith(input.overrides ?? {}),
    env: {},
    projectPath: null,
    backupRoot: '/tmp/backups',
  };
}

async function categoryOf(ctx: CapabilityContext, kind: string) {
  const { categories } = await codexCapabilities.list(ctx);
  return categories.find((entry) => entry.kind === kind);
}

describe('codexCapabilities.list', () => {
  it('lists MCP servers as launch items, honoring disabledCapabilities', async () => {
    const category = await categoryOf(
      contextWith({ disabledCapabilities: [{ kind: 'mcp', id: 'search' }] }),
      'mcp',
    );
    expect(category?.error).toBeNull();
    expect(category?.items.map((item) => [item.id, item.enabled, item.applyMode])).toEqual([
      ['docs', true, 'launch'],
      ['my.server', false, 'launch'],
      ['search', false, 'launch'],
    ]);
  });

  it('lists only installed plugins with native enabled state', async () => {
    const category = await categoryOf(
      contextWith({
        disabledCapabilities: [{ kind: 'plugin', id: 'github@openai-curated-remote' }],
      }),
      'plugin',
    );
    expect(category?.items).toEqual([
      expect.objectContaining({
        id: 'github@openai-curated-remote',
        name: 'github',
        enabled: true,
        applyMode: 'account-file',
        source: 'plugin',
      }),
      expect.objectContaining({ id: 'visualize@openai-curated-remote', enabled: false }),
    ]);
  });

  it('keeps a failing MCP command from hiding plugins', async () => {
    const ctx = contextWith({ overrides: { mcp: { exitCode: 1, stdout: '' } } });
    expect((await categoryOf(ctx, 'plugin'))?.error).toBeNull();
  });

  it('reports a failing or unparsable command in the category', async () => {
    const failed = contextWith({ overrides: { mcp: { exitCode: 1, stdout: '' } } });
    const garbage = contextWith({ overrides: { mcp: { exitCode: 0, stdout: 'not json' } } });
    const message = 'Não foi possível listar os servidores MCP do Codex.';
    expect((await categoryOf(failed, 'mcp'))?.error).toBe(message);
    expect((await categoryOf(garbage, 'mcp'))?.error).toBe(message);
  });

  it('reports not found when the binary is missing', async () => {
    const ctx = contextWith({ overrides: { mcp: { notFound: true }, plugin: { notFound: true } } });
    expect((await categoryOf(ctx, 'mcp'))?.error).toBe('codex não encontrado.');
    expect((await categoryOf(ctx, 'plugin'))?.error).toBe('codex não encontrado.');
  });
});

async function withAccountDir<T>(run: (ctx: CapabilityContext) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'codex-cap-'));
  try {
    const base = contextWith({});
    const homeDir = join(root, 'acc');
    await mkdir(homeDir);
    return await run({
      ...base,
      account: { ...base.account, homeDir },
      env: { HOME: join(root, 'home') },
      backupRoot: join(root, 'backups'),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSkill(input: { dir: string; name: string; body: string }): Promise<void> {
  await mkdir(join(input.dir, input.name), { recursive: true });
  await writeFile(join(input.dir, input.name, 'SKILL.md'), input.body);
}

describe('codexCapabilities.list skills', () => {
  it('reads skills from the real home and the account, with native disabled state', async () => {
    await withAccountDir(async (ctx) => {
      const shared = join(ctx.env['HOME'] ?? '', '.agents', 'skills');
      await writeSkill({
        dir: shared,
        name: 'off-skill',
        body: '---\nname: off-skill\ndescription: "Does a thing"\n---\n# body\n',
      });
      await writeSkill({ dir: join(ctx.account.homeDir, 'skills'), name: 'on-skill', body: '# x' });
      await writeFile(join(ctx.account.homeDir, 'config.toml'), fixture('codex-config.toml'));
      const skills = (await categoryOf(ctx, 'skill'))?.items ?? [];
      expect(skills.map((item) => [item.id, item.description, item.enabled])).toEqual([
        ['off-skill', 'Does a thing', false],
        ['on-skill', null, true],
      ]);
      expect(skills[0]).toMatchObject({ applyMode: 'account-file', source: 'user' });
    });
  });

  it('lists nothing and no error when config.toml and skill dirs are missing', async () => {
    await withAccountDir(async (ctx) => {
      expect(await categoryOf(ctx, 'skill')).toMatchObject({ items: [], error: null });
    });
  });

  it('skips the real home directory when HOME is undefined', async () => {
    await withAccountDir(async (ctx) => {
      await writeSkill({ dir: join(ctx.account.homeDir, 'skills'), name: 'only', body: '# x' });
      const items = (await categoryOf({ ...ctx, env: {} }, 'skill'))?.items ?? [];
      expect(items.map((item) => item.id)).toEqual(['only']);
    });
  });
});

describe('codexCapabilities.setEnabled', () => {
  it('creates config.toml with a disabled plugin table when the file is missing', async () => {
    await withAccountDir(async (ctx) => {
      const ref = { kind: 'plugin', id: 'github@openai-curated-remote' } as const;
      await codexCapabilities.setEnabled({ ctx, ref, enabled: false });
      const toml = await readFile(join(ctx.account.homeDir, 'config.toml'), 'utf8');
      expect(toml).toBe('[plugins."github@openai-curated-remote"]\nenabled = false\n');
    });
  });

  it('backs up the existing config.toml before editing a skill', async () => {
    await withAccountDir(async (ctx) => {
      const file = join(ctx.account.homeDir, 'config.toml');
      await writeFile(file, 'model = "x"\n');
      await codexCapabilities.setEnabled({
        ctx,
        ref: { kind: 'skill', id: 'docs' },
        enabled: false,
      });
      expect(await readFile(file, 'utf8')).toBe(
        'model = "x"\n\n[[skills.config]]\nname = "docs"\nenabled = false\n',
      );
      const backups = await readdir(ctx.backupRoot);
      expect(backups).toHaveLength(1);
      expect(await readFile(join(ctx.backupRoot, backups[0] ?? ''), 'utf8')).toBe('model = "x"\n');
    });
  });

  it('rejects MCP refs because MCP only supports launch mode', async () => {
    await expect(
      codexCapabilities.setEnabled({
        ctx: contextWith({}),
        ref: { kind: 'mcp', id: 'docs' },
        enabled: false,
      }),
    ).rejects.toThrow('MCP do Codex usa só o modo launch.');
  });
});

describe('codexCapabilities.launchArgs', () => {
  it('disables only MCP refs with -c pairs', () => {
    expect(
      codexCapabilities.launchArgs([
        { kind: 'mcp', id: 'my.server' },
        { kind: 'plugin', id: 'github@openai-curated-remote' },
        { kind: 'skill', id: 'docs' },
      ]),
    ).toEqual(['-c', 'mcp_servers."my.server".enabled=false']);
  });

  it('returns nothing when no MCP is disabled', () => {
    expect(codexCapabilities.launchArgs([])).toEqual([]);
  });
});
