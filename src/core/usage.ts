import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageSnapshot, UsageWindow } from './chat-types.js';
import { isolatedEnv } from './launch.js';
import { providers, readGeminiAuthState } from './providers.js';
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

export type UsageErrorCode = 'no-credentials' | 'http' | 'bad-response' | 'unauthorized';

const HTTP_UNAUTHORIZED = 401;

export class UsageError extends Error {
  readonly code: UsageErrorCode;
  readonly status: number | null;

  constructor(code: UsageErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'UsageError';
    this.code = code;
    this.status = status;
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

interface ClaudeAccessToken {
  token: string;
  expiresAt: number | null;
}

function accessTokenFrom(raw: string): ClaudeAccessToken | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const oauth = parsed['claudeAiOauth'];
  if (!isRecord(oauth)) return null;
  const token = oauth['accessToken'];
  if (typeof token !== 'string' || token.length === 0) return null;
  return { token, expiresAt: finiteNumber(oauth['expiresAt']) };
}

async function tokenFromFile(homeDir: string): Promise<ClaudeAccessToken | null> {
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

async function tokenFromKeychain(ctx: UsageContext): Promise<ClaudeAccessToken | null> {
  const result = await ctx.deps.runner.run({
    command: 'security',
    args: ['find-generic-password', '-s', claudeKeychainService(ctx.account.homeDir), '-w'],
    env: process.env,
  });
  if ('notFound' in result || result.exitCode !== 0) return null;
  return accessTokenFrom(result.stdout.trim());
}

async function claudeAccessToken(ctx: UsageContext): Promise<ClaudeAccessToken> {
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

async function fetchUsageJson(
  ctx: UsageContext,
  request: { url: string; headers: Record<string, string>; provider: string },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await ctx.deps.fetch(request.url, {
      headers: request.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new UsageError(
        'http',
        `${request.provider} usage request failed with status ${response.status}`,
        response.status,
      );
    }
    return await response.json().catch(() => undefined);
  } finally {
    clearTimeout(timer);
  }
}

function fetchClaudeBody(ctx: UsageContext, token: string): Promise<unknown> {
  return fetchUsageJson(ctx, {
    url: CLAUDE_USAGE_URL,
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': CLAUDE_OAUTH_BETA },
    provider: 'Claude',
  });
}

const CLAUDE_LIMIT_GROUP_KIND: Record<string, UsageWindow['kind']> = {
  session: 'session',
  weekly: 'weekly',
  monthly: 'monthly',
};

function claudeLimitScope(limit: Record<string, unknown>): string | null {
  const scope = limit['scope'];
  if (!isRecord(scope)) return null;
  const model = scope['model'];
  const name = isRecord(model) ? model['display_name'] : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

function claudeScopedWindow(limit: unknown): UsageWindow | null {
  if (!isRecord(limit)) return null;
  const scope = claudeLimitScope(limit);
  const group = limit['group'];
  const kind = typeof group === 'string' ? CLAUDE_LIMIT_GROUP_KIND[group] : undefined;
  const percent = finiteNumber(limit['percent']);
  if (scope === null || kind === undefined || percent === null) return null;
  const resetsAt = limit['resets_at'];
  return {
    kind,
    usedPercent: clampPercent(percent),
    resetsAt: typeof resetsAt === 'string' ? toIsoOrNull(new Date(resetsAt)) : null,
    scope,
  };
}

function claudeScopedWindows(body: Record<string, unknown>): UsageWindow[] {
  const limits = body['limits'];
  const scoped = Array.isArray(limits)
    ? limits.map(claudeScopedWindow).filter((window): window is UsageWindow => window !== null)
    : [];
  if (scoped.length > 0) return scoped;
  return [
    { scope: 'Opus', value: body['seven_day_opus'] },
    { scope: 'Sonnet', value: body['seven_day_sonnet'] },
  ].flatMap(({ scope, value }) => {
    const window = claudeWindow('weekly', value);
    return window === null ? [] : [{ ...window, scope }];
  });
}

function claudeExtraMonthlyWindow(extra: unknown): UsageWindow | null {
  if (!isRecord(extra) || extra['is_enabled'] !== true) return null;
  const utilization = finiteNumber(extra['utilization']);
  if (utilization === null) return null;
  const resetsAt = extra['resets_at'];
  return {
    kind: 'monthly',
    usedPercent: clampPercent(utilization),
    resetsAt: typeof resetsAt === 'string' ? toIsoOrNull(new Date(resetsAt)) : null,
  };
}

async function fetchClaudeBodyDetectingRevocation(ctx: UsageContext): Promise<unknown> {
  const access = await claudeAccessToken(ctx);
  try {
    return await fetchClaudeBody(ctx, access.token);
  } catch (error: unknown) {
    const stillValid = access.expiresAt !== null && access.expiresAt > ctx.deps.now().getTime();
    if (error instanceof UsageError && error.status === HTTP_UNAUTHORIZED && stillValid) {
      throw new UsageError(
        'unauthorized',
        'Claude rejected an unexpired OAuth token',
        HTTP_UNAUTHORIZED,
      );
    }
    throw error;
  }
}

async function readClaudeUsage(ctx: UsageContext): Promise<UsageWindow[]> {
  const body = await fetchClaudeBodyDetectingRevocation(ctx);
  if (!isRecord(body))
    throw new UsageError('bad-response', 'Claude usage response is not an object');
  return [
    claudeWindow('session', body['five_hour']),
    claudeWindow('weekly', body['seven_day']),
    claudeWindow('monthly', body['monthly']) ?? claudeExtraMonthlyWindow(body['extra_usage']),
    ...claudeScopedWindows(body),
  ].filter((window): window is UsageWindow => window !== null);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const MINUTES_PER_DAY = 24 * 60;

function kindForWindowMinutes(minutes: number): UsageWindow['kind'] {
  if (minutes <= MINUTES_PER_DAY) return 'session';
  if (minutes <= 8 * MINUTES_PER_DAY) return 'weekly';
  return 'monthly';
}

function codexWindowMinutes(value: Record<string, unknown>): number | null {
  const minutes = finiteNumber(value['window_minutes']);
  if (minutes !== null) return minutes;
  const seconds = finiteNumber(value['limit_window_seconds']);
  return seconds === null ? null : seconds / 60;
}

function codexWindow(
  fallbackKind: UsageWindow['kind'],
  value: unknown,
  baseMs: number,
): UsageWindow | null {
  if (!isRecord(value)) return null;
  const used = finiteNumber(value['used_percent']);
  if (used === null) return null;
  const minutes = codexWindowMinutes(value);
  const resetsAtSeconds = finiteNumber(value['resets_at']) ?? finiteNumber(value['reset_at']);
  const resetsInSeconds =
    finiteNumber(value['resets_in_seconds']) ?? finiteNumber(value['reset_after_seconds']);
  let resetsAt: string | null = null;
  if (resetsAtSeconds !== null) resetsAt = toIsoOrNull(new Date(resetsAtSeconds * 1000));
  else if (resetsInSeconds !== null)
    resetsAt = toIsoOrNull(new Date(baseMs + resetsInSeconds * 1000));
  return {
    kind: minutes === null ? fallbackKind : kindForWindowMinutes(minutes),
    usedPercent: clampPercent(used),
    resetsAt,
  };
}

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

interface CodexCredentials {
  accessToken: string;
  accountId: string | null;
}

async function codexCredentials(homeDir: string): Promise<CodexCredentials | null> {
  let raw: string;
  try {
    raw = await readFile(join(homeDir, 'auth.json'), 'utf8');
  } catch (error: unknown) {
    if (isMissingPath(error)) return null;
    throw error;
  }
  const parsed = parseJson(raw);
  const tokens = isRecord(parsed) ? parsed['tokens'] : undefined;
  if (!isRecord(tokens)) return null;
  const accessToken = tokens['access_token'];
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  const accountId = tokens['account_id'];
  return { accessToken, accountId: typeof accountId === 'string' ? accountId : null };
}

function codexRateLimitWindows(
  rateLimit: unknown,
  input: { baseMs: number; scope?: string },
): UsageWindow[] {
  if (!isRecord(rateLimit)) return [];
  return [
    codexWindow('session', rateLimit['primary_window'], input.baseMs),
    codexWindow('weekly', rateLimit['secondary_window'], input.baseMs),
  ]
    .filter((window): window is UsageWindow => window !== null)
    .map((window) => (input.scope === undefined ? window : { ...window, scope: input.scope }));
}

function codexAdditionalWindows(additional: unknown, baseMs: number): UsageWindow[] {
  if (!Array.isArray(additional)) return [];
  return additional.filter(isRecord).flatMap((entry) => {
    const name = entry['limit_name'] ?? entry['metered_feature'];
    if (typeof name !== 'string' || name.trim() === '') return [];
    return codexRateLimitWindows(entry['rate_limit'], { baseMs, scope: name.trim() });
  });
}

function codexApiWindows(body: unknown, baseMs: number): UsageWindow[] {
  if (!isRecord(body)) return [];
  return [
    ...codexRateLimitWindows(body['rate_limit'], { baseMs }),
    ...codexRateLimitWindows(body['code_review_rate_limit'], { baseMs, scope: 'Code review' }),
    ...codexAdditionalWindows(body['additional_rate_limits'], baseMs),
  ];
}

async function readCodexApiUsage(ctx: UsageContext): Promise<UsageWindow[]> {
  const credentials = await codexCredentials(ctx.account.homeDir);
  if (credentials === null) return [];
  const headers: Record<string, string> = { Authorization: `Bearer ${credentials.accessToken}` };
  if (credentials.accountId !== null) headers['ChatGPT-Account-Id'] = credentials.accountId;
  let body: unknown;
  try {
    body = await fetchUsageJson(ctx, { url: CODEX_USAGE_URL, headers, provider: 'Codex' });
  } catch (error: unknown) {
    if (error instanceof Error) return [];
    throw error;
  }
  return codexApiWindows(body, ctx.deps.now().getTime());
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
    codexWindow('monthly', limits['monthly'], baseMs),
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

function agyBucketWindow(
  kind: UsageWindow['kind'],
  bucket: Record<string, unknown>,
): UsageWindow | null {
  const remaining = finiteNumber(bucket['remaining_fraction']);
  if (remaining === null) return null;
  const reset = bucket['reset_time'];
  const resetsAt = typeof reset === 'string' ? toIsoOrNull(new Date(reset)) : null;
  return {
    kind,
    usedPercent: clampPercent(Math.round((1 - remaining) * 1000) / 10),
    resetsAt,
  };
}

const AGY_PRIMARY_GROUP = 'Gemini Models';
const AGY_BUCKET_WINDOWS: readonly {
  kind: UsageWindow['kind'];
  window: string;
  idSuffix: string;
}[] = [
  { kind: 'session', window: '5h', idSuffix: '-5h' },
  { kind: 'weekly', window: 'weekly', idSuffix: '-weekly' },
  { kind: 'monthly', window: 'monthly', idSuffix: '-monthly' },
];

function parseAgyUsageBuckets(buckets: unknown[]): UsageWindow[] {
  const records = buckets.filter(isRecord);
  return AGY_BUCKET_WINDOWS.map(({ kind, window, idSuffix }) => {
    const bucket = records.find((b) => {
      const id = b['id'];
      return b['window'] === window || (typeof id === 'string' && id.endsWith(idSuffix));
    });
    return bucket !== undefined ? agyBucketWindow(kind, bucket) : null;
  }).filter((usageWindow): usageWindow is UsageWindow => usageWindow !== null);
}

function parseAgyUsageGroups(groups: unknown[]): UsageWindow[] {
  const records = groups.filter(isRecord);
  const primary = records.find((g) => g['name'] === AGY_PRIMARY_GROUP) ?? records[0];
  return records.flatMap((group) => {
    const buckets = Array.isArray(group['buckets']) ? group['buckets'] : [];
    const windows = parseAgyUsageBuckets(buckets);
    const name = group['name'];
    if (group === primary) return windows;
    if (typeof name !== 'string' || name.trim() === '') return [];
    return windows.map((usageWindow) => ({ ...usageWindow, scope: name.trim() }));
  });
}

async function readGeminiUsage(
  ctx: UsageContext,
): Promise<{ windows: UsageWindow[]; source: UsageSnapshot['source'] }> {
  const auth = await readGeminiAuthState(ctx.account.homeDir);
  if (auth !== 'logged-in') {
    throw new UsageError('no-credentials', 'No Antigravity CLI login token found for this account');
  }
  const result = await ctx.deps.runner.run({
    command: providers.gemini.binary,
    args: ['-p', '/usage', '--output-format', 'json'],
    env: isolatedEnv(ctx.account, process.env),
  });
  if ('notFound' in result) return { windows: [], source: 'unavailable' };
  if (result.exitCode !== 0) {
    throw new UsageError(
      'bad-response',
      `Gemini usage command failed with exit ${result.exitCode}`,
    );
  }
  const body = parseJson(result.stdout);
  if (!isRecord(body) || body['status'] !== 'SUCCESS') {
    throw new UsageError('bad-response', 'Gemini usage response is not valid');
  }
  const command = body['command'];
  const data = isRecord(command) ? command['data'] : undefined;
  const groups = isRecord(data) && Array.isArray(data['groups']) ? data['groups'] : null;
  if (groups === null) {
    throw new UsageError('bad-response', 'Gemini usage response missing groups');
  }
  return { windows: parseAgyUsageGroups(groups), source: 'api' };
}

export function exhaustionResetAt(windows: readonly UsageWindow[]): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    if (window.usedPercent < 100 || window.resetsAt === null) continue;
    const ms = Date.parse(window.resetsAt);
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latest = window.resetsAt;
    latestMs = ms;
  }
  return latest;
}

export function exhaustionVerdict(input: {
  resetsAt: string | null;
  now: Date;
  fresh: UsageSnapshot | null;
}): 'exhausted' | 'available' {
  const { fresh, resetsAt, now } = input;
  if (fresh !== null && fresh.source !== 'unavailable') {
    const stillLimited = fresh.windows.some((window) => {
      if (window.usedPercent < 100) return false;
      if (window.resetsAt === null) return true;
      const windowReset = Date.parse(window.resetsAt);
      return Number.isNaN(windowReset) || windowReset > now.getTime();
    });
    return stillLimited ? 'exhausted' : 'available';
  }
  if (resetsAt === null) return 'available';
  const resetMs = Date.parse(resetsAt);
  return Number.isNaN(resetMs) || resetMs <= now.getTime() ? 'available' : 'exhausted';
}

export async function readUsage(ctx: UsageContext): Promise<UsageSnapshot> {
  const provider = ctx.account.provider;
  const fetchedAt = ctx.deps.now().toISOString();
  switch (provider) {
    case 'claude':
      return { provider, windows: await readClaudeUsage(ctx), source: 'api', fetchedAt };
    case 'codex': {
      const apiWindows = await readCodexApiUsage(ctx);
      if (apiWindows.length > 0) return { provider, windows: apiWindows, source: 'api', fetchedAt };
      const windows = await readCodexUsage(ctx.account.homeDir);
      return {
        provider,
        windows,
        source: windows.length > 0 ? 'rollout' : 'unavailable',
        fetchedAt,
      };
    }
    case 'gemini': {
      const { windows, source } = await readGeminiUsage(ctx);
      return { provider, windows, source, fetchedAt };
    }
    case 'deepseek':
    case 'kimi':
    case 'grok':
    case 'qwen':
    case 'opencode':
      return { provider, windows: [], source: 'unavailable', fetchedAt };
  }
}
