import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { UsageDeps } from './usage.js';

export const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const CREDENTIALS_FILE = '.credentials.json';
const REFRESH_LOCK_DIR = '.oauth_refresh.lock';
const LOCK_STALE_MS = 60_000;
const LOCK_HEARTBEAT_MS = 5_000;
const SECURITY_STDIN_LIMIT = 4032;
const SAVE_ATTEMPTS = 2;
const REFRESH_TIMEOUT_MS = 15_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const REJECTED_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

export type ClaudeOAuthDeps = Pick<UsageDeps, 'platform' | 'runner' | 'fetch' | 'now'>;

type CredentialSource = { kind: 'file'; path: string } | { kind: 'keychain'; service: string };

export interface ClaudeOAuth {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  clientId: string | null;
}

export interface ClaudeCredentials {
  source: CredentialSource;
  document: Record<string, unknown>;
  oauth: ClaudeOAuth;
}

export type ClaudeRefreshOutcome =
  | { kind: 'refreshed'; oauth: ClaudeOAuth }
  | { kind: 'missing' }
  | { kind: 'no-refresh-token' }
  | { kind: 'busy' }
  | { kind: 'rejected' }
  | { kind: 'save-failed' }
  | { kind: 'rate-limited'; retryAfter: string | null }
  | { kind: 'failed'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

function parseDocument(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function oauthFrom(document: Record<string, unknown>): ClaudeOAuth | null {
  const oauth = document['claudeAiOauth'];
  if (!isRecord(oauth)) return null;
  const accessToken = nonEmptyString(oauth['accessToken']);
  if (accessToken === null) return null;
  const scopes = oauth['scopes'];
  return {
    accessToken,
    refreshToken: nonEmptyString(oauth['refreshToken']),
    expiresAt: finiteNumber(oauth['expiresAt']),
    scopes: Array.isArray(scopes)
      ? scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    clientId: nonEmptyString(oauth['clientId']),
  };
}

export function claudeKeychainService(homeDir: string): string {
  const hash = createHash('sha256').update(homeDir).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

async function credentialsFromFile(homeDir: string): Promise<ClaudeCredentials | null> {
  const path = join(homeDir, CREDENTIALS_FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
  const document = parseDocument(raw);
  const oauth = document === null ? null : oauthFrom(document);
  return document !== null && oauth !== null
    ? { source: { kind: 'file', path }, document, oauth }
    : null;
}

async function credentialsFromKeychain(
  deps: ClaudeOAuthDeps,
  homeDir: string,
): Promise<ClaudeCredentials | null> {
  const service = claudeKeychainService(homeDir);
  const result = await deps.runner.run({
    command: 'security',
    args: ['find-generic-password', '-s', service, '-w'],
    env: process.env,
  });
  if ('notFound' in result || result.exitCode !== 0) return null;
  const document = parseDocument(result.stdout.trim());
  const oauth = document === null ? null : oauthFrom(document);
  return document !== null && oauth !== null
    ? { source: { kind: 'keychain', service }, document, oauth }
    : null;
}

export async function readClaudeCredentials(
  deps: ClaudeOAuthDeps,
  homeDir: string,
): Promise<ClaudeCredentials | null> {
  const fromFile = await credentialsFromFile(homeDir);
  if (fromFile !== null) return fromFile;
  return deps.platform === 'darwin' ? credentialsFromKeychain(deps, homeDir) : null;
}

export function isClaudeTokenExpired(oauth: ClaudeOAuth, now: Date): boolean {
  return oauth.expiresAt !== null && oauth.expiresAt <= now.getTime();
}

async function acquireLockDir(path: string, now: Date): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  const info = await stat(path).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  if (info !== null && now.getTime() - info.mtimeMs <= LOCK_STALE_MS) return false;
  await rm(path, { recursive: true, force: true });
  try {
    await mkdir(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
}

async function acquireRefreshLock(
  homeDir: string,
  now: Date,
): Promise<(() => Promise<void>) | null> {
  const primary = join(homeDir, REFRESH_LOCK_DIR);
  const resolvedHome = await realpath(homeDir).catch(() => homeDir);
  const legacy = `${resolvedHome.replace(/[\\/]+$/, '')}.lock`;
  if (!(await acquireLockDir(primary, now))) return null;
  if (!(await acquireLockDir(legacy, now))) {
    await rm(primary, { recursive: true, force: true });
    return null;
  }
  const heartbeat = setInterval(() => {
    const touchedAt = new Date();
    void Promise.allSettled([
      utimes(primary, touchedAt, touchedAt),
      utimes(legacy, touchedAt, touchedAt),
    ]);
  }, LOCK_HEARTBEAT_MS);
  return async () => {
    clearInterval(heartbeat);
    await rm(legacy, { recursive: true, force: true });
    await rm(primary, { recursive: true, force: true });
  };
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  refreshTokenExpiresInSeconds: number | null;
  scopes: string[] | null;
}

function tokenResponseFrom(body: unknown): TokenResponse | null {
  if (!isRecord(body)) return null;
  const accessToken = nonEmptyString(body['access_token']);
  const expiresInSeconds = finiteNumber(body['expires_in']);
  if (accessToken === null || expiresInSeconds === null) return null;
  const scope = nonEmptyString(body['scope']);
  return {
    accessToken,
    refreshToken: nonEmptyString(body['refresh_token']),
    expiresInSeconds,
    refreshTokenExpiresInSeconds: finiteNumber(body['refresh_token_expires_in']),
    scopes: scope === null ? null : scope.split(' ').filter((item) => item.length > 0),
  };
}

function grantError(body: unknown): string | null {
  return isRecord(body) ? nonEmptyString(body['error']) : null;
}

type TokenRequestResult =
  | { kind: 'ok'; body: unknown }
  | { kind: 'http'; status: number; body: unknown; retryAfter: string | null };

async function postTokenRequest(
  deps: ClaudeOAuthDeps,
  payload: Record<string, string>,
): Promise<TokenRequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await deps.fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => undefined);
    if (response.status === 200) return { kind: 'ok', body };
    return {
      kind: 'http',
      status: response.status,
      body,
      retryAfter: response.headers?.get('retry-after') ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function refreshedOAuth(input: {
  current: ClaudeOAuth;
  document: Record<string, unknown>;
  response: TokenResponse;
  now: Date;
}): { oauth: ClaudeOAuth; document: Record<string, unknown> } {
  const { current, document, response, now } = input;
  const previous = isRecord(document['claudeAiOauth']) ? document['claudeAiOauth'] : {};
  const refreshToken = response.refreshToken ?? current.refreshToken;
  const expiresAt = now.getTime() + response.expiresInSeconds * 1000;
  const scopes = response.scopes ?? current.scopes;
  const nextOAuth: Record<string, unknown> = {
    ...previous,
    accessToken: response.accessToken,
    refreshToken,
    expiresAt,
    scopes,
  };
  if (response.refreshTokenExpiresInSeconds !== null) {
    nextOAuth['refreshTokenExpiresAt'] =
      now.getTime() + response.refreshTokenExpiresInSeconds * 1000;
  }
  return {
    oauth: { ...current, accessToken: response.accessToken, refreshToken, expiresAt, scopes },
    document: { ...document, claudeAiOauth: nextOAuth },
  };
}

type WriteTarget =
  { kind: 'file'; path: string } | { kind: 'keychain'; service: string; account: string };

function securityQuoted(value: string): string {
  if (/["\\\n]/.test(value)) throw new Error('Unsupported character in keychain attribute');
  return `"${value}"`;
}

async function resolveWriteTarget(
  deps: ClaudeOAuthDeps,
  source: CredentialSource,
): Promise<WriteTarget> {
  if (source.kind === 'file') return source;
  const result = await deps.runner.run({
    command: 'security',
    args: ['find-generic-password', '-s', source.service],
    env: process.env,
  });
  if ('notFound' in result) throw new Error('security binary not found');
  if (result.exitCode !== 0) {
    return { kind: 'keychain', service: source.service, account: userInfo().username };
  }
  // REGEX: captures the value of the `"acct"<blob>="..."` attribute line printed by security(1)
  const account = /"acct"<blob>="([^"\n]+)"/.exec(result.stdout)?.[1];
  if (account === undefined) throw new Error('Could not read the keychain account attribute');
  securityQuoted(account);
  return { kind: 'keychain', service: source.service, account };
}

async function writeFileAtomically(path: string, serialized: string): Promise<void> {
  const temporary = `${path}.inova-${process.pid}.tmp`;
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeKeychain(
  deps: ClaudeOAuthDeps,
  input: { target: Extract<WriteTarget, { kind: 'keychain' }>; serialized: string },
): Promise<void> {
  const { target, serialized } = input;
  const hex = Buffer.from(serialized, 'utf8').toString('hex');
  const args = ['-U', '-a', target.account, '-s', target.service, '-X', hex];
  const line = `add-generic-password -U -a ${securityQuoted(target.account)} -s ${securityQuoted(target.service)} -X "${hex}"\n`;
  const result =
    line.length <= SECURITY_STDIN_LIMIT
      ? await deps.runner.run({ command: 'security', args: ['-i'], env: process.env, input: line })
      : await deps.runner.run({
          command: 'security',
          args: ['add-generic-password', ...args],
          env: process.env,
        });
  if ('notFound' in result || result.exitCode !== 0) {
    throw new Error('Failed to save refreshed Claude credentials to the keychain');
  }
}

async function storedDocumentText(
  deps: ClaudeOAuthDeps,
  target: WriteTarget,
): Promise<string | null> {
  if (target.kind === 'file') return readFile(target.path, 'utf8').catch(() => null);
  const result = await deps.runner.run({
    command: 'security',
    args: ['find-generic-password', '-s', target.service, '-w'],
    env: process.env,
  });
  return 'notFound' in result || result.exitCode !== 0 ? null : result.stdout.trim();
}

async function persistCredentials(
  deps: ClaudeOAuthDeps,
  input: { target: WriteTarget; document: Record<string, unknown> },
): Promise<boolean> {
  const serialized = JSON.stringify(input.document);
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const written = await (
      input.target.kind === 'file'
        ? writeFileAtomically(input.target.path, serialized)
        : writeKeychain(deps, { target: input.target, serialized })
    ).then(
      () => true,
      () => false,
    );
    if (written && (await storedDocumentText(deps, input.target)) === serialized) return true;
  }
  return false;
}

async function refreshTokenChanged(
  deps: ClaudeOAuthDeps,
  input: { homeDir: string; previousRefreshToken: string },
): Promise<ClaudeOAuth | null> {
  const latest = await readClaudeCredentials(deps, input.homeDir);
  if (latest === null || latest.oauth.refreshToken === input.previousRefreshToken) return null;
  return isClaudeTokenExpired(latest.oauth, deps.now()) ? null : latest.oauth;
}

async function refreshLocked(
  deps: ClaudeOAuthDeps,
  homeDir: string,
): Promise<ClaudeRefreshOutcome> {
  const credentials = await readClaudeCredentials(deps, homeDir);
  if (credentials === null) return { kind: 'missing' };
  if (!isClaudeTokenExpired(credentials.oauth, deps.now())) {
    return { kind: 'refreshed', oauth: credentials.oauth };
  }
  const refreshToken = credentials.oauth.refreshToken;
  if (refreshToken === null) return { kind: 'no-refresh-token' };
  const target = await resolveWriteTarget(deps, credentials.source);
  const payload: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: credentials.oauth.clientId ?? CLAUDE_OAUTH_CLIENT_ID,
  };
  if (credentials.oauth.scopes.length > 0) payload['scope'] = credentials.oauth.scopes.join(' ');
  const result = await postTokenRequest(deps, payload);
  if (result.kind === 'http') {
    if (result.status === HTTP_TOO_MANY_REQUESTS) {
      return { kind: 'rate-limited', retryAfter: result.retryAfter };
    }
    const error = grantError(result.body);
    if (error !== null && REJECTED_GRANT_ERRORS.has(error)) {
      const latest = await refreshTokenChanged(deps, {
        homeDir,
        previousRefreshToken: refreshToken,
      });
      return latest === null ? { kind: 'rejected' } : { kind: 'refreshed', oauth: latest };
    }
    return { kind: 'failed', reason: `token endpoint answered ${result.status}` };
  }
  const response = tokenResponseFrom(result.body);
  if (response === null) return { kind: 'failed', reason: 'token endpoint sent an invalid body' };
  const next = refreshedOAuth({
    current: credentials.oauth,
    document: credentials.document,
    response,
    now: deps.now(),
  });
  const saved = await persistCredentials(deps, { target, document: next.document });
  return saved ? { kind: 'refreshed', oauth: next.oauth } : { kind: 'save-failed' };
}

export async function refreshClaudeCredentials(
  deps: ClaudeOAuthDeps,
  homeDir: string,
): Promise<ClaudeRefreshOutcome> {
  const release = await acquireRefreshLock(homeDir, deps.now());
  if (release === null) return { kind: 'busy' };
  try {
    return await refreshLocked(deps, homeDir);
  } catch (error: unknown) {
    if (error instanceof Error) return { kind: 'failed', reason: error.message };
    throw error;
  } finally {
    await release();
  }
}
