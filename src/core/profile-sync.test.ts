import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandRunner } from './providers.js';
import {
  applyProfileSync,
  buildAgyMcpAddArgs,
  buildClaudeMcpAddJsonArgs,
  formatCodexMcpToml,
  maskSecretsInText,
  mergeOpencodeMcpJson,
  previewProfileSync,
} from './profile-sync.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-profile-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('profile-sync helpers', () => {
  test('formats codex config.toml preserving existing keys and marks unsupported server types as incompatible', () => {
    const existing = 'cli_auth_credentials_store = "file"\nmodel = "gpt-5"\n';
    const result = formatCodexMcpToml(existing, {
      postgres: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: { PG_URL: 'postgres://user:secret@localhost/db' },
      },
      remote: {
        type: 'http',
        url: 'https://mcp.example.com/v1',
        headers: { Authorization: 'Bearer tok_123' },
      },
      legacySse: {
        type: 'sse',
        url: 'https://legacy.example.com/sse',
      },
    });

    expect(result.content).toContain('cli_auth_credentials_store = "file"');
    expect(result.content).toContain('model = "gpt-5"');
    expect(result.content).toContain('[mcp_servers.postgres]');
    expect(result.content).toContain('command = "npx"');
    expect(result.content).toContain('[mcp_servers.postgres.env]');
    expect(result.content).toContain('[mcp_servers.remote]');
    expect(result.content).toContain('http_headers');
    expect(result.incompatible).toEqual([
      {
        name: 'legacySse',
        reason:
          'Codex config.toml não suporta transporte SSE legado diretamente; use http ou stdio.',
      },
    ]);
  });

  test('merges opencode.json mcp block preserving other keys and generates CLI args for agy and claude', () => {
    const existing = JSON.stringify({ agents: { default: 'build' }, theme: 'dark' }, null, 2);
    const merged = mergeOpencodeMcpJson(existing, {
      fs: { command: 'npx', args: ['-y', 'server-fs'], env: { ROOT_TOKEN: 'secret-val' } },
      docs: { type: 'http', url: 'https://docs.example.com/mcp', headers: { 'X-Api-Key': 'k1' } },
    });
    const parsed = JSON.parse(merged.content) as Record<string, unknown>;
    expect(parsed['agents']).toEqual({ default: 'build' });
    expect(parsed['theme']).toBe('dark');
    expect(parsed['mcp']).toEqual({
      fs: {
        type: 'local',
        command: ['npx', '-y', 'server-fs'],
        environment: { ROOT_TOKEN: 'secret-val' },
      },
      docs: {
        type: 'remote',
        url: 'https://docs.example.com/mcp',
        headers: { 'X-Api-Key': 'k1' },
      },
    });

    expect(
      buildAgyMcpAddArgs('fs', {
        command: 'npx',
        args: ['-y', 'server-fs'],
        env: { ROOT_TOKEN: 'secret-val' },
      }),
    ).toEqual({
      args: [
        'mcp',
        'add',
        '-t',
        'stdio',
        '-e',
        'ROOT_TOKEN=secret-val',
        'fs',
        '--',
        'npx',
        '-y',
        'server-fs',
      ],
    });
    expect(
      buildAgyMcpAddArgs('docs', {
        type: 'http',
        url: 'https://docs.example.com/mcp',
        headers: { Authorization: 'Bearer abc' },
      }),
    ).toEqual({
      args: [
        'mcp',
        'add',
        '-t',
        'http',
        '-H',
        'Authorization: Bearer abc',
        'docs',
        'https://docs.example.com/mcp',
      ],
    });
    expect(buildClaudeMcpAddJsonArgs('fs', { command: 'npx', args: ['-y', 'server-fs'] })).toEqual([
      'mcp',
      'add-json',
      '--scope',
      'user',
      'fs',
      '{"command":"npx","args":["-y","server-fs"]}',
    ]);
  });

  test('masks secret env vars and headers in preview text', () => {
    const raw = JSON.stringify({
      mcpServers: {
        api: {
          command: 'node',
          args: ['srv.js'],
          env: { API_TOKEN: 'super-secret-value' },
          headers: { Authorization: 'Bearer real-jwt-token' },
        },
      },
    });
    const masked = maskSecretsInText(raw);
    expect(masked).not.toContain('super-secret-value');
    expect(masked).not.toContain('real-jwt-token');
    expect(masked).toContain('API_TOKEN');

    const toml = [
      'cli_auth_credentials_store = "file"',
      '[mcp_servers.remote]',
      'url = "https://mcp.example.com/v1"',
      'http_headers = { X-Api-Key = "header-secret-123", "Authorization" = "Custom abc" }',
      '[mcp_servers.remote.env]',
      'api_key = "lower-secret-456"',
      '"custom-secret" = "quoted-secret-789"',
    ].join('\n');
    const maskedToml = maskSecretsInText(toml);
    expect(maskedToml).not.toContain('header-secret-123');
    expect(maskedToml).not.toContain('Custom abc');
    expect(maskedToml).not.toContain('lower-secret-456');
    expect(maskedToml).not.toContain('quoted-secret-789');
    expect(maskedToml).toContain('url = "https://mcp.example.com/v1"');
  });

  test('throws descriptive error on malformed target JSON instead of raw SyntaxError', () => {
    expect(() => mergeOpencodeMcpJson('{ broken json', {})).toThrow(
      /opencode\.json|JSON inválido/i,
    );
  });

  test('imports MCP servers from a configured account when .mcp.json does not exist', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const codexHome = await tmp();
    await writeFile(
      join(claudeHome, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', 'mcp-github'], env: { GH_TOKEN: 'secret-gh' } },
        },
      }),
    );
    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n');
    const accounts = [
      { id: 'acc-claude', provider: 'claude' as const, label: 'claude-1', homeDir: claudeHome },
      { id: 'acc-codex', provider: 'codex' as const, label: 'codex-1', homeDir: codexHome },
    ];

    const preview = await previewProfileSync({
      projectPath: project,
      accounts,
      sourceAccountId: 'acc-claude',
    });
    expect(preview.mcpSourceExists).toBe(false);
    expect(preview.mcpServerCount).toBe(1);
    expect(preview.items.find((item) => item.id === 'mcp:acc-codex')?.status).toBe('update');

    await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      sourceAccountId: 'acc-claude',
      approvedIds: preview.items.map((item) => item.id),
    });
    expect(await readFile(join(codexHome, 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.github]',
    );
  });

  test('preview detects conflicts & masks secrets; apply saves timestamped backup, copies/symlinks rules, and runs agy CLI', async () => {
    const root = await tmp();
    const project = await tmp();
    const claudeHome = await tmp();
    const codexHome = await tmp();
    const geminiHome = await tmp();
    const qwenHome = await tmp();

    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: { CONTEXT7_API_KEY: 'secret-key-999' },
          },
        },
      }),
    );
    await writeFile(join(project, 'AGENTS.md'), '# Regras do projeto\nSempre rode pnpm test.\n');
    await writeFile(join(project, 'CLAUDE.md'), '# Regras antigas do Claude\n');

    await writeFile(
      join(claudeHome, '.claude.json'),
      JSON.stringify({ hasCompletedOnboarding: true, mcpServers: {} }),
    );
    await writeFile(join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
    await mkdir(join(qwenHome, '.qwen'), { recursive: true });
    await writeFile(join(qwenHome, '.qwen', 'settings.json'), '{}');

    const accounts = [
      { id: 'acc-claude', provider: 'claude' as const, label: 'claude-1', homeDir: claudeHome },
      { id: 'acc-codex', provider: 'codex' as const, label: 'codex-1', homeDir: codexHome },
      { id: 'acc-gemini', provider: 'gemini' as const, label: 'gemini-1', homeDir: geminiHome },
      { id: 'acc-qwen', provider: 'qwen' as const, label: 'qwen-1', homeDir: qwenHome },
    ];

    const preview = await previewProfileSync({
      projectPath: project,
      accounts,
      rulesSource: 'AGENTS.md',
    });

    const claudeRules = preview.items.find((item) => item.id === 'rules:CLAUDE.md');
    expect(claudeRules?.status).toBe('conflict');
    const codexMcp = preview.items.find((item) => item.id === 'mcp:acc-codex');
    expect(codexMcp?.status).toBe('update');
    expect(codexMcp?.maskedAfter).not.toContain('secret-key-999');

    const run = vi.fn<CommandRunner['run']>(async () => ({ exitCode: 0, stdout: 'added' }));
    const applied = await applyProfileSync({
      root,
      projectPath: project,
      accounts,
      rulesSource: 'AGENTS.md',
      approvedIds: preview.items.map((item) => item.id),
      rulesStrategy: 'copy',
      runner: { run },
      now: () => new Date('2026-11-13T12:00:00.000Z'),
    });

    expect(applied.backupDir).toContain(join('backups', 'profile-sync'));
    const backupEntries = await readdir(applied.backupDir);
    expect(backupEntries.length).toBeGreaterThan(0);

    expect(await readFile(join(project, 'CLAUDE.md'), 'utf8')).toBe(
      '# Regras do projeto\nSempre rode pnpm test.\n',
    );
    const updatedCodex = await readFile(join(codexHome, 'config.toml'), 'utf8');
    expect(updatedCodex).toContain('cli_auth_credentials_store = "file"');
    expect(updatedCodex).toContain('[mcp_servers.context7]');
    expect(await readFile(join(qwenHome, '.qwen', 'settings.json'), 'utf8')).toContain('context7');
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'agy',
        args: expect.arrayContaining(['mcp', 'add', '-t', 'stdio']),
        env: expect.objectContaining({ HOME: geminiHome }),
      }),
    );

    const geminiStats = await lstat(join(project, 'GEMINI.md'));
    expect(geminiStats.isFile()).toBe(true);
  });
});
