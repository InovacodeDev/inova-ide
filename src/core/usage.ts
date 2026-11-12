import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toIsoOrNull(date: Date): string | null {
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
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

export async function readUsage(ctx: UsageContext): Promise<UsageSnapshot> {
  const provider = ctx.account.provider;
  const fetchedAt = ctx.deps.now().toISOString();
  switch (provider) {
    case 'claude':
      return { provider, windows: await readClaudeUsage(ctx), source: 'api', fetchedAt };
    case 'codex':
    case 'gemini':
      return { provider, windows: [], source: 'unavailable', fetchedAt };
  }
}
