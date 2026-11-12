import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageSnapshot, UsageWindow } from './chat-types.js';
import type { CommandRunner } from './providers.js';
import type { Account } from './types.js';

export interface UsageDeps {
  platform: NodeJS.Platform;
  runner: CommandRunner;
  fetch: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  now: () => Date;
}

export type UsageErrorCode = 'no-credentials' | 'http' | 'bad-response';

export class UsageError extends Error {
  readonly code: UsageErrorCode;

  constructor(code: UsageErrorCode, message: string) {
    super(message);
    this.name = 'UsageError';
    this.code = code;
  }
}

interface UsageContext {
  account: Account;
  deps: UsageDeps;
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const USAGE_TIMEOUT_MS = 10_000;
const CODEX_DAY_DIR_LIMIT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toIsoOrNull(date: Date): string | null {
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function accessTokenFrom(raw: string): string | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const oauth = parsed['claudeAiOauth'];
  if (!isRecord(oauth)) return null;
  const token = oauth['accessToken'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

async function tokenFromFile(homeDir: string): Promise<string | null> {
  try {
    return accessTokenFrom(await readFile(join(homeDir, '.credentials.json'), 'utf8'));
  } catch (error: unknown) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

function claudeKeychainService(homeDir: string): string {
  const hash = createHash('sha256').update(homeDir).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

async function tokenFromKeychain(ctx: UsageContext): Promise<string | null> {
  const result = await ctx.deps.runner.run({
    command: 'security',
    args: ['find-generic-password', '-s', claudeKeychainService(ctx.account.homeDir), '-w'],
    env: process.env,
  });
  if ('notFound' in result || result.exitCode !== 0) return null;
  return accessTokenFrom(result.stdout.trim());
}

async function claudeAccessToken(ctx: UsageContext): Promise<string> {
  const fromFile = await tokenFromFile(ctx.account.homeDir);
  if (fromFile !== null) return fromFile;
  const fromKeychain = ctx.deps.platform === 'darwin' ? await tokenFromKeychain(ctx) : null;
  if (fromKeychain !== null) return fromKeychain;
  throw new UsageError('no-credentials', 'No Claude OAuth credentials found for this account');
}

function claudeWindow(kind: UsageWindow['kind'], value: unknown): UsageWindow | null {
  if (!isRecord(value)) return null;
  const utilization = value['utilization'];
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  const resetsAt = value['resets_at'];
  return {
    kind,
    usedPercent: clampPercent(utilization),
    resetsAt: typeof resetsAt === 'string' ? toIsoOrNull(new Date(resetsAt)) : null,
  };
}

async function fetchClaudeBody(ctx: UsageContext, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await ctx.deps.fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': CLAUDE_OAUTH_BETA },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new UsageError('http', `Claude usage request failed with status ${response.status}`);
    }
    return await response.json().catch(() => undefined);
  } finally {
    clearTimeout(timer);
  }
}

async function readClaudeUsage(ctx: UsageContext): Promise<UsageWindow[]> {
  const body = await fetchClaudeBody(ctx, await claudeAccessToken(ctx));
  if (!isRecord(body))
    throw new UsageError('bad-response', 'Claude usage response is not an object');
  return [
    claudeWindow('session', body['five_hour']),
    claudeWindow('weekly', body['seven_day']),
  ].filter((window): window is UsageWindow => window !== null);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function codexWindow(
  kind: UsageWindow['kind'],
  value: unknown,
  baseMs: number,
): UsageWindow | null {
  if (!isRecord(value)) return null;
  const used = finiteNumber(value['used_percent']);
  if (used === null) return null;
  const resetsAtSeconds = finiteNumber(value['resets_at']);
  const resetsInSeconds = finiteNumber(value['resets_in_seconds']);
  let resetsAt: string | null = null;
  if (resetsAtSeconds !== null) resetsAt = toIsoOrNull(new Date(resetsAtSeconds * 1000));
  else if (resetsInSeconds !== null)
    resetsAt = toIsoOrNull(new Date(baseMs + resetsInSeconds * 1000));
  return { kind, usedPercent: clampPercent(used), resetsAt };
}

function codexLineWindows(line: string, mtimeMs: number): UsageWindow[] {
  const parsed = parseJson(line);
  if (!isRecord(parsed) || parsed['type'] !== 'event_msg') return [];
  const payload = parsed['payload'];
  if (!isRecord(payload) || payload['type'] !== 'token_count') return [];
  const limits = payload['rate_limits'];
  if (!isRecord(limits)) return [];
  const timestamp = parsed['timestamp'];
  const lineMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  const baseMs = Number.isFinite(lineMs) ? lineMs : mtimeMs;
  return [
    codexWindow('session', limits['primary'], baseMs),
    codexWindow('weekly', limits['secondary'], baseMs),
  ].filter((window): window is UsageWindow => window !== null);
}

async function numericEntriesDescending(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(b) - Number(a));
  } catch (error: unknown) {
    if (isMissingPath(error)) return [];
    throw error;
  }
}

async function newestDayDirs(sessionsDir: string): Promise<string[]> {
  const days: string[] = [];
  for (const year of await numericEntriesDescending(sessionsDir)) {
    for (const month of await numericEntriesDescending(join(sessionsDir, year))) {
      for (const day of await numericEntriesDescending(join(sessionsDir, year, month))) {
        days.push(join(sessionsDir, year, month, day));
        if (days.length >= CODEX_DAY_DIR_LIMIT) return days;
      }
    }
  }
  return days;
}

async function rolloutFilesByMtime(
  dayDirs: string[],
): Promise<{ path: string; mtimeMs: number }[]> {
  const files: { path: string; mtimeMs: number }[] = [];
  for (const dir of dayDirs) {
    const names = await readdir(dir);
    for (const name of names.filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
      const path = join(dir, name);
      files.push({ path, mtimeMs: (await stat(path)).mtimeMs });
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function readCodexUsage(homeDir: string): Promise<UsageWindow[]> {
  const files = await rolloutFilesByMtime(await newestDayDirs(join(homeDir, 'sessions')));
  for (const file of files) {
    const lines = (await readFile(file.path, 'utf8')).split('\n').reverse();
    for (const line of lines) {
      const windows = codexLineWindows(line, file.mtimeMs);
      if (windows.length > 0) return windows;
    }
  }
  return [];
}

export async function readUsage(ctx: UsageContext): Promise<UsageSnapshot> {
  const provider = ctx.account.provider;
  const fetchedAt = ctx.deps.now().toISOString();
  switch (provider) {
    case 'claude':
      return { provider, windows: await readClaudeUsage(ctx), source: 'api', fetchedAt };
    case 'codex': {
      const windows = await readCodexUsage(ctx.account.homeDir);
      return {
        provider,
        windows,
        source: windows.length > 0 ? 'rollout' : 'unavailable',
        fetchedAt,
      };
    }
    case 'gemini':
      return { provider, windows: [], source: 'unavailable', fetchedAt };
  }
}
