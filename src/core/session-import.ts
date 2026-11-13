import { createReadStream, constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createChatParser } from './chat-events.js';
import type { ChatEvent } from './chat-types.js';

export const IMPORT_PROVIDERS = ['claude', 'codex'] as const;

export type ImportProvider = (typeof IMPORT_PROVIDERS)[number];

export interface ExternalSession {
  provider: ImportProvider;
  id: string;
  title: string;
  updatedAt: string;
  sizeBytes: number;
}

type SessionImportErrorCode = 'not-found' | 'same-home';

export class SessionImportError extends Error {
  readonly code: SessionImportErrorCode;

  constructor(code: SessionImportErrorCode, message: string) {
    super(message);
    this.name = 'SessionImportError';
    this.code = code;
  }
}

type Json = Record<string, unknown>;

interface Located {
  file: string;
  relPath: string;
}

const FALLBACK_TITLE = 'Sessão importada';
const TITLE_CHARS = 80;
const HEAD_BYTES = 4 * 1024 * 1024;
const MAX_CODEX_ROLLOUTS = 1000;
const DONE: ChatEvent = { kind: 'done', isError: false, costUsd: null, durationMs: null };
// REGEX: UUID canônico (8-4-4-4-12 hex); ids de sessão do Claude e do Codex seguem este formato.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// REGEX: mensagens "de usuário" geradas pelo CLI (comandos, lembretes, contexto) começam com uma tag XML.
const SYSTEM_TAG_PATTERN = /^\s*<[a-z][a-z0-9_-]*[\s>]/i;

export function isImportProvider(value: unknown): value is ImportProvider {
  return IMPORT_PROVIDERS.some((provider) => provider === value);
}

export function isExternalSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function defaultCliHome(provider: ImportProvider, env: NodeJS.ProcessEnv): string {
  const home = env['HOME'] || homedir();
  if (provider === 'claude') return resolve(env['CLAUDE_CONFIG_DIR'] || join(home, '.claude'));
  return resolve(env['CODEX_HOME'] || join(home, '.codex'));
}

export function claudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function decodeLine(line: string): Json | null {
  if (line.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function scanLines(input: {
  file: string;
  maxBytes?: number;
  visit: (entry: Json, raw: string) => boolean;
}): Promise<void> {
  const stream = createReadStream(input.file, {
    encoding: 'utf8',
    ...(input.maxBytes === undefined ? {} : { end: input.maxBytes - 1 }),
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const entry = decodeLine(line);
      if (entry !== null && !input.visit(entry, line)) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function textOfBlocks(content: unknown, blockType: string): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block['type'] === 'tool_result') return null;
    const text = str(block['text']);
    if (block['type'] === blockType && text !== null) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function promptText(text: string | null): string | null {
  if (text === null || text.trim() === '' || SYSTEM_TAG_PATTERN.test(text)) return null;
  return text;
}

function claudePrompt(entry: Json): string | null {
  if (entry['type'] !== 'user' || entry['isMeta'] === true || entry['isSidechain'] === true) {
    return null;
  }
  const message = entry['message'];
  return isRecord(message) ? promptText(textOfBlocks(message['content'], 'text')) : null;
}

function codexMessage(entry: Json, role: 'user' | 'assistant'): string | null {
  const payload = entry['payload'];
  if (entry['type'] !== 'response_item' || !isRecord(payload)) return null;
  if (payload['type'] !== 'message' || payload['role'] !== role) return null;
  const text = textOfBlocks(payload['content'], role === 'user' ? 'input_text' : 'output_text');
  return role === 'user' ? promptText(text) : text;
}

function titleOf(prompt: string | null): string {
  const line = (prompt ?? '').trim().split('\n')[0]?.trim() ?? '';
  return line === '' ? FALLBACK_TITLE : line.slice(0, TITLE_CHARS);
}

async function regularFileStat(file: string): Promise<{ size: number; mtime: Date } | null> {
  try {
    const stat = await lstat(file);
    return stat.isFile() ? { size: stat.size, mtime: stat.mtime } : null;
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readClaudeHead(
  file: string,
): Promise<{ cwd: string | null; prompt: string | null }> {
  let cwd: string | null = null;
  let prompt: string | null = null;
  await scanLines({
    file,
    maxBytes: HEAD_BYTES,
    visit: (entry) => {
      cwd ??= str(entry['cwd']);
      prompt ??= claudePrompt(entry);
      return cwd === null || prompt === null;
    },
  });
  return { cwd, prompt };
}

async function readCodexHead(
  file: string,
): Promise<{ id: string | null; cwd: string | null; prompt: string | null }> {
  let id: string | null = null;
  let cwd: string | null = null;
  let prompt: string | null = null;
  let first = true;
  await scanLines({
    file,
    maxBytes: HEAD_BYTES,
    visit: (entry) => {
      if (first) {
        first = false;
        const payload = entry['payload'];
        if (entry['type'] !== 'session_meta' || !isRecord(payload)) return false;
        id = str(payload['id']);
        cwd = str(payload['cwd']);
        return true;
      }
      prompt ??= codexMessage(entry, 'user');
      return prompt === null;
    },
  });
  return { id, cwd, prompt };
}

async function describe(input: {
  provider: ImportProvider;
  id: string;
  file: string;
  prompt: string | null;
}): Promise<ExternalSession | null> {
  const stat = await regularFileStat(input.file);
  if (stat === null) return null;
  return {
    provider: input.provider,
    id: input.id,
    title: titleOf(input.prompt),
    updatedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function listClaude(sourceHome: string, projectPath: string): Promise<ExternalSession[]> {
  const dir = join(sourceHome, 'projects', claudeProjectDirName(projectPath));
  const sessions: ExternalSession[] = [];
  for (const name of await listDir(dir)) {
    const id = basename(name, '.jsonl');
    if (!name.endsWith('.jsonl') || !isExternalSessionId(id)) continue;
    const file = join(dir, name);
    if ((await regularFileStat(file)) === null) continue;
    const head = await readClaudeHead(file);
    if (head.cwd !== null && head.cwd !== projectPath) continue;
    const session = await describe({ provider: 'claude', id, file, prompt: head.prompt });
    if (session) sessions.push(session);
  }
  return sessions;
}

async function codexRollouts(sourceHome: string): Promise<string[]> {
  const root = join(sourceHome, 'sessions');
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
  // NOTE: o nome do rollout começa com a data, então a ordem decrescente por nome é a mais recente primeiro.
  return entries
    .filter((entry) => /^rollout-.*\.jsonl$/.test(basename(entry)))
    .sort((a, b) => basename(b).localeCompare(basename(a)))
    .slice(0, MAX_CODEX_ROLLOUTS)
    .map((entry) => join(root, entry));
}

async function listCodex(sourceHome: string, projectPath: string): Promise<ExternalSession[]> {
  const sessions: ExternalSession[] = [];
  for (const file of await codexRollouts(sourceHome)) {
    if ((await regularFileStat(file)) === null) continue;
    const head = await readCodexHead(file);
    if (!isExternalSessionId(head.id) || head.cwd !== projectPath) continue;
    const session = await describe({
      provider: 'codex',
      id: head.id,
      file,
      prompt: head.prompt,
    });
    if (session) sessions.push(session);
  }
  return sessions;
}

export async function listExternalSessions(input: {
  provider: ImportProvider;
  sourceHome: string;
  projectPath: string;
}): Promise<ExternalSession[]> {
  const { provider, sourceHome, projectPath } = input;
  const sessions =
    provider === 'claude'
      ? await listClaude(sourceHome, projectPath)
      : await listCodex(sourceHome, projectPath);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function locate(input: {
  provider: ImportProvider;
  sourceHome: string;
  projectPath: string;
  sessionId: string;
}): Promise<Located | null> {
  const { provider, sourceHome, projectPath, sessionId } = input;
  if (!isExternalSessionId(sessionId)) return null;
  if (provider === 'claude') {
    const relPath = join('projects', claudeProjectDirName(projectPath), `${sessionId}.jsonl`);
    const file = join(sourceHome, relPath);
    if ((await regularFileStat(file)) === null) return null;
    const { cwd } = await readClaudeHead(file);
    return cwd !== null && cwd !== projectPath ? null : { file, relPath };
  }
  for (const file of await codexRollouts(sourceHome)) {
    if ((await regularFileStat(file)) === null) continue;
    const head = await readCodexHead(file);
    if (head.id === sessionId && head.cwd === projectPath) {
      return { file, relPath: relative(sourceHome, file) };
    }
  }
  return null;
}

function isoOf(value: unknown, fallback: string): string {
  const text = str(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : fallback;
}

async function readEvents(input: {
  provider: ImportProvider;
  file: string;
  sessionId: string;
  fallbackAt: string;
}): Promise<{ title: string; events: ChatEvent[] }> {
  const { provider, file, sessionId, fallbackAt } = input;
  const parser = createChatParser('claude', { turnId: sessionId });
  const events: ChatEvent[] = [];
  let firstPrompt: string | null = null;
  let block = 0;

  const pushPrompt = (text: string, at: unknown): void => {
    if (events.length > 0) events.push(DONE);
    firstPrompt ??= text;
    events.push({ kind: 'user', text, at: isoOf(at, fallbackAt) });
  };

  await scanLines({
    file,
    visit: (entry, raw) => {
      if (provider === 'claude') {
        if (entry['isSidechain'] === true) return true;
        const prompt = claudePrompt(entry);
        if (prompt !== null) pushPrompt(prompt, entry['timestamp']);
        else if (entry['type'] === 'assistant' || entry['type'] === 'user') {
          events.push(...parser.parse(raw));
        }
        return true;
      }
      const prompt = codexMessage(entry, 'user');
      if (prompt !== null) {
        pushPrompt(prompt, entry['timestamp']);
        return true;
      }
      const reply = codexMessage(entry, 'assistant');
      if (reply !== null) {
        block += 1;
        events.push({ kind: 'text', blockId: `import-${sessionId}-${block}`, text: reply });
      }
      return true;
    },
  });
  if (events.length > 0) events.push(DONE);
  return { title: titleOf(firstPrompt), events };
}

export async function importExternalSession(input: {
  provider: ImportProvider;
  sourceHome: string;
  targetHome: string;
  projectPath: string;
  sessionId: string;
}): Promise<{ title: string; events: ChatEvent[] }> {
  const { provider, sourceHome, targetHome, projectPath, sessionId } = input;
  if (resolve(sourceHome) === resolve(targetHome)) {
    throw new SessionImportError('same-home', 'A conta de destino já é a origem desta sessão.');
  }
  const located = await locate({ provider, sourceHome, projectPath, sessionId });
  if (located === null) {
    throw new SessionImportError('not-found', `Sessão externa não encontrada: ${sessionId}`);
  }
  const stat = await regularFileStat(located.file);
  const fallbackAt = (stat?.mtime ?? new Date()).toISOString();
  const parsed = await readEvents({ provider, file: located.file, sessionId, fallbackAt });
  const target = join(targetHome, located.relPath);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await copyFile(located.file, target, fsConstants.COPYFILE_EXCL);
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  return parsed;
}
