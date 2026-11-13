import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SessionImportError,
  claudeProjectDirName,
  defaultCliHome,
  importExternalSession,
  isExternalSessionId,
  isImportProvider,
  listExternalSessions,
} from './session-import.js';

const PROJECT = '/Users/dev/my.app';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

let source: string;
let target: string;

function jsonl(entries: readonly unknown[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function claudeEntries(input: { cwd: string; prompt: string }): unknown[] {
  return [
    { type: 'queue-operation', operation: 'enqueue', sessionId: ID_A },
    {
      type: 'user',
      isMeta: true,
      cwd: input.cwd,
      message: { role: 'user', content: [{ type: 'text', text: 'meta context' }] },
    },
    {
      type: 'user',
      cwd: input.cwd,
      timestamp: '2026-11-01T10:00:00.000Z',
      message: { role: 'user', content: '<command-name>/clear</command-name>' },
    },
    {
      type: 'user',
      cwd: input.cwd,
      timestamp: '2026-11-01T10:00:01.000Z',
      message: { role: 'user', content: input.prompt },
    },
    {
      type: 'assistant',
      isSidechain: true,
      message: { id: 'side', content: [{ type: 'text', text: 'subagent noise' }] },
    },
    {
      type: 'assistant',
      message: {
        id: 'msg1',
        content: [
          { type: 'text', text: 'Vou ler o arquivo.' },
          { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'conteúdo' }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-11-01T10:05:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'segunda pergunta' }] },
    },
    { type: 'assistant', message: { id: 'msg2', content: [{ type: 'text', text: 'Feito.' }] } },
  ];
}

async function writeClaude(input: {
  id: string;
  cwd?: string;
  prompt?: string;
  dirPath?: string;
}): Promise<string> {
  const dir = join(source, 'projects', claudeProjectDirName(input.dirPath ?? PROJECT));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${input.id}.jsonl`);
  await writeFile(
    file,
    jsonl(claudeEntries({ cwd: input.cwd ?? PROJECT, prompt: input.prompt ?? 'Corrija o bug\nx' })),
  );
  return file;
}

async function writeCodex(input: { id: string; cwd: string; day: string }): Promise<string> {
  const dir = join(source, 'sessions', '2026', '10', input.day);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `rollout-2026-10-${input.day}T10-00-00-${input.id}.jsonl`);
  await writeFile(
    file,
    jsonl([
      { type: 'session_meta', payload: { id: input.id, cwd: input.cwd } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-10-21T10:00:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Explique o módulo' }],
        },
      },
      { type: 'response_item', payload: { type: 'reasoning', summary: [] } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'O módulo faz X.' }],
        },
      },
    ]),
  );
  return file;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof SessionImportError ? error.code : undefined;
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'inova-import-'));
  source = join(root, 'source');
  target = join(root, 'target');
  await mkdir(source);
  await mkdir(target);
});

describe('session-import guards', () => {
  it('accepts only canonical UUIDs as external session ids', () => {
    expect(isExternalSessionId(ID_A)).toBe(true);
    expect(isExternalSessionId('../../etc/passwd')).toBe(false);
    expect(isExternalSessionId(`${ID_A}/..`)).toBe(false);
    expect(isExternalSessionId('')).toBe(false);
    expect(isExternalSessionId(42)).toBe(false);
  });

  it('accepts only providers with a confirmed format', () => {
    expect(isImportProvider('claude')).toBe(true);
    expect(isImportProvider('codex')).toBe(true);
    expect(isImportProvider('gemini')).toBe(false);
  });

  it('encodes the Claude project folder like the CLI', () => {
    expect(claudeProjectDirName('/Users/dev/my.app/.claude')).toBe('-Users-dev-my-app--claude');
  });

  it('resolves the default CLI home from the environment', () => {
    expect(defaultCliHome('claude', { HOME: '/h' })).toBe('/h/.claude');
    expect(defaultCliHome('claude', { HOME: '/h', CLAUDE_CONFIG_DIR: '/c' })).toBe('/c');
    expect(defaultCliHome('codex', { HOME: '/h' })).toBe('/h/.codex');
    expect(defaultCliHome('codex', { HOME: '/h', CODEX_HOME: '/x' })).toBe('/x');
  });
});

describe('listExternalSessions', () => {
  it('lists Claude sessions of the project with title from the first real prompt', async () => {
    await writeClaude({ id: ID_A });
    const sessions = await listExternalSessions({
      provider: 'claude',
      sourceHome: source,
      projectPath: PROJECT,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ provider: 'claude', id: ID_A, title: 'Corrija o bug' });
    expect(sessions[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('skips sessions whose recorded cwd is another folder with the same encoded name', async () => {
    await writeClaude({ id: ID_A, cwd: '/Users/dev/my/app' });
    expect(
      await listExternalSessions({ provider: 'claude', sourceHome: source, projectPath: PROJECT }),
    ).toEqual([]);
  });

  it('ignores symlinks, non-UUID names and a missing folder', async () => {
    const real = await writeClaude({ id: ID_A, dirPath: '/elsewhere' });
    const dir = join(source, 'projects', claudeProjectDirName(PROJECT));
    await mkdir(dir, { recursive: true });
    await symlink(real, join(dir, `${ID_B}.jsonl`));
    await writeFile(join(dir, 'notes.jsonl'), '{}\n');
    expect(
      await listExternalSessions({ provider: 'claude', sourceHome: source, projectPath: PROJECT }),
    ).toEqual([]);
    expect(
      await listExternalSessions({ provider: 'claude', sourceHome: source, projectPath: '/none' }),
    ).toEqual([]);
  });

  it('lists Codex rollouts matching the project cwd', async () => {
    await writeCodex({ id: ID_A, cwd: PROJECT, day: '20' });
    await writeCodex({ id: ID_B, cwd: '/other', day: '21' });
    const sessions = await listExternalSessions({
      provider: 'codex',
      sourceHome: source,
      projectPath: PROJECT,
    });
    expect(sessions.map((session) => session.id)).toEqual([ID_A]);
    expect(sessions[0]?.title).toBe('Explique o módulo');
  });
});

describe('importExternalSession', () => {
  it('copies the Claude file into the account home and converts the history', async () => {
    const file = await writeClaude({ id: ID_A });
    const result = await importExternalSession({
      provider: 'claude',
      sourceHome: source,
      targetHome: target,
      projectPath: PROJECT,
      sessionId: ID_A,
    });
    const copied = join(target, 'projects', claudeProjectDirName(PROJECT), `${ID_A}.jsonl`);
    expect(await readFile(copied, 'utf8')).toBe(await readFile(file, 'utf8'));
    expect(result.title).toBe('Corrija o bug');
    expect(result.events.map((event) => event.kind)).toEqual([
      'user',
      'text',
      'tool-use',
      'tool-result',
      'done',
      'user',
      'text',
      'done',
    ]);
    expect(result.events[0]).toEqual({
      kind: 'user',
      text: 'Corrija o bug\nx',
      at: '2026-11-01T10:00:01.000Z',
    });
    expect(result.events[3]).toMatchObject({ toolId: 'tool1', output: 'conteúdo' });
  });

  it('keeps an already continued copy instead of overwriting it', async () => {
    await writeClaude({ id: ID_A });
    const dir = join(target, 'projects', claudeProjectDirName(PROJECT));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID_A}.jsonl`), 'continued\n');
    await importExternalSession({
      provider: 'claude',
      sourceHome: source,
      targetHome: target,
      projectPath: PROJECT,
      sessionId: ID_A,
    });
    expect(await readFile(join(dir, `${ID_A}.jsonl`), 'utf8')).toBe('continued\n');
  });

  it('copies a Codex rollout keeping its dated path', async () => {
    await writeCodex({ id: ID_A, cwd: PROJECT, day: '20' });
    const result = await importExternalSession({
      provider: 'codex',
      sourceHome: source,
      targetHome: target,
      projectPath: PROJECT,
      sessionId: ID_A,
    });
    const copied = join(
      target,
      'sessions',
      '2026',
      '10',
      '20',
      `rollout-2026-10-20T10-00-00-${ID_A}.jsonl`,
    );
    expect(await readFile(copied, 'utf8')).toContain('session_meta');
    expect(result.events).toEqual([
      { kind: 'user', text: 'Explique o módulo', at: '2026-10-21T10:00:00.000Z' },
      { kind: 'text', blockId: `import-${ID_A}-1`, text: 'O módulo faz X.' },
      { kind: 'done', isError: false, costUsd: null, durationMs: null },
    ]);
  });

  it('rejects unknown ids, traversal ids, foreign cwd and same-home imports', async () => {
    await writeClaude({ id: ID_A });
    await writeClaude({ id: ID_B, cwd: '/Users/dev/my/app' });
    await writeCodex({ id: ID_C, cwd: '/other', day: '20' });
    const base = { sourceHome: source, targetHome: target, projectPath: PROJECT };
    expect(
      await codeOf(importExternalSession({ ...base, provider: 'claude', sessionId: ID_C })),
    ).toBe('not-found');
    expect(
      await codeOf(importExternalSession({ ...base, provider: 'claude', sessionId: `../${ID_A}` })),
    ).toBe('not-found');
    expect(
      await codeOf(importExternalSession({ ...base, provider: 'claude', sessionId: ID_B })),
    ).toBe('not-found');
    expect(
      await codeOf(importExternalSession({ ...base, provider: 'codex', sessionId: ID_C })),
    ).toBe('not-found');
    expect(
      await codeOf(
        importExternalSession({
          ...base,
          targetHome: source,
          provider: 'claude',
          sessionId: ID_A,
        }),
      ),
    ).toBe('same-home');
  });
});
