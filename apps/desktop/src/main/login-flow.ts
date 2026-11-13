import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaunchSpec } from '@inova/core/launch';
import { PROVIDER_CREDENTIAL_FILES, type AuthStatus } from '@inova/core/providers';
import type { Account, ProviderId } from '@inova/core/types';
import type { LoginEvent, LoginStage, StartedLogin } from '../shared/api.js';
import type { SessionManager } from './sessions.js';

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_POLL_MS = 700;
const DEFAULT_TIMEOUT_MS = 300_000;
const ALREADY_AUTH_SETTLE_MS = 2500;
const METHOD_SELECT_DELAY_MS = 60;
const MAX_BUFFER_CHARS = 32_768;

// REGEX: strip VT OSC, CSI, and single-char escape sequences emitted by interactive CLIs
const ANSI_ESCAPE =
  /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;
// REGEX: match an HTTPS OAuth URL at start of occurrence
const URL_START = /https:\/\/[^\s"'<>]+/;
// REGEX: match an indented wrapped continuation line of a long URL in TUI output
const URL_WRAP_CONTINUATION =
  /^[ ]*\n[ ]{2,}([A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)(?=[ ]*(?:\n|$))/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

export function extractAuthUrl(rawOutput: string): string | null {
  const clean = stripAnsi(rawOutput).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = URL_START.exec(clean);
  if (!match) return null;
  let url = match[0];
  let cursor = match.index + url.length;
  while (cursor < clean.length) {
    const next = URL_WRAP_CONTINUATION.exec(clean.slice(cursor));
    if (!next || !next[1]) break;
    url += next[1];
    cursor += next[0].length;
  }
  return url;
}

export async function readGeminiTokensTimestamp(homeDir: string): Promise<number> {
  return readFilesTimestamp(homeDir, PROVIDER_CREDENTIAL_FILES.gemini ?? []);
}

async function readFilesTimestamp(homeDir: string, relFiles: readonly string[]): Promise<number> {
  let latest = 0;
  for (const rel of relFiles) {
    try {
      const info = await stat(join(homeDir, rel));
      if (info.mtimeMs > latest) latest = info.mtimeMs;
    } catch {
      continue;
    }
  }
  return latest;
}

function hasFilePolling(provider: ProviderId): boolean {
  const files = PROVIDER_CREDENTIAL_FILES[provider];
  return files !== undefined && files.length > 0;
}

interface FlowState {
  sessionId: string;
  account: Account;
  baseEnv: NodeJS.ProcessEnv;
  stage: LoginStage;
  buffer: string;
  authUrl: string | null;
  codePrompt: boolean;
  sentMethodEnter: boolean;
  sentTrustEnter: boolean;
  initialStatus: AuthStatus;
  initialTimestamp: number;
  startedAt: number;
  settled: boolean;
  canceled: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  actionTimer: ReturnType<typeof setTimeout> | null;
}

export interface LoginFlowDeps {
  sessions: SessionManager;
  checkStatus: (input: { account: Account; baseEnv: NodeJS.ProcessEnv }) => Promise<AuthStatus>;
  emit: (event: LoginEvent) => void;
  onAuthenticated?: (accountId: string) => void;
  readTokensTimestamp?: (homeDir: string) => Promise<number>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  alreadyAuthSettleMs?: number;
  methodSelectDelayMs?: number;
}

export interface LoginFlowManager {
  start(input: {
    account: Account;
    spec: LaunchSpec;
    file: string;
    baseEnv: NodeJS.ProcessEnv;
  }): Promise<StartedLogin>;
  submitCode(input: { sessionId: string; code: string }): boolean;
  cancel(sessionId: string): void;
  handlePtyData(sessionId: string, chunk: string): void;
  handlePtyExit(sessionId: string, exitCode: number): Promise<void>;
}

export function createLoginFlowManager(deps: LoginFlowDeps): LoginFlowManager {
  const flows = new Map<string, FlowState>();
  const flowsByAccount = new Map<string, string>();
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const alreadyAuthMs = deps.alreadyAuthSettleMs ?? ALREADY_AUTH_SETTLE_MS;
  const methodDelayMs = deps.methodSelectDelayMs ?? METHOD_SELECT_DELAY_MS;
  const readTimestamp = (provider: ProviderId, homeDir: string): Promise<number> => {
    if (provider === 'gemini' && deps.readTokensTimestamp) return deps.readTokensTimestamp(homeDir);
    return readFilesTimestamp(homeDir, PROVIDER_CREDENTIAL_FILES[provider] ?? []);
  };

  function emitState(flow: FlowState, stage: LoginStage, message: string | null = null): void {
    flow.stage = stage;
    deps.emit({
      sessionId: flow.sessionId,
      stage,
      authUrl: flow.authUrl,
      codePrompt: flow.codePrompt,
      message,
    });
  }

  function cleanupFlow(flow: FlowState): void {
    flow.settled = true;
    if (flow.pollTimer !== null) clearInterval(flow.pollTimer);
    if (flow.timeoutTimer !== null) clearTimeout(flow.timeoutTimer);
    if (flow.actionTimer !== null) clearTimeout(flow.actionTimer);
    flow.pollTimer = null;
    flow.timeoutTimer = null;
    flow.actionTimer = null;
    flows.delete(flow.sessionId);
    if (flowsByAccount.get(flow.account.id) === flow.sessionId) {
      flowsByAccount.delete(flow.account.id);
    }
  }

  function closePtySafely(sessionId: string): void {
    try {
      deps.sessions.close(sessionId);
    } catch (error: unknown) {
      console.error(`inova: failed to close login session ${sessionId}`, error);
    }
  }

  async function pollCompletion(flow: FlowState): Promise<void> {
    if (flow.settled) return;
    const status = await deps.checkStatus({ account: flow.account, baseEnv: flow.baseEnv });
    if (flow.settled || status !== 'logged-in') return;
    const elapsed = Date.now() - flow.startedAt;
    const timestamp = await readTimestamp(flow.account.provider, flow.account.homeDir);
    if (flow.settled) return;
    const unlockedNew = flow.initialStatus !== 'logged-in';
    const refreshedExisting = timestamp > flow.initialTimestamp;
    const alreadyVerified = !flow.sentMethodEnter && elapsed >= alreadyAuthMs;
    if (!unlockedNew && !refreshedExisting && !alreadyVerified) return;
    cleanupFlow(flow);
    emitState(flow, 'verifying');
    closePtySafely(flow.sessionId);
    deps.onAuthenticated?.(flow.account.id);
    emitState(flow, 'succeeded');
  }

  function cancel(sessionId: string): void {
    const flow = flows.get(sessionId);
    if (!flow || flow.settled) return;
    flow.canceled = true;
    cleanupFlow(flow);
    closePtySafely(sessionId);
    emitState(flow, 'canceled');
  }

  function startTimers(flow: FlowState): void {
    flow.timeoutTimer = setTimeout(() => {
      if (flow.settled) return;
      cleanupFlow(flow);
      closePtySafely(flow.sessionId);
      emitState(flow, 'failed', 'Tempo limite da autenticação excedido. Tente novamente.');
    }, timeoutMs);

    if (hasFilePolling(flow.account.provider)) {
      flow.pollTimer = setInterval(() => {
        void pollCompletion(flow).catch((error: unknown) => {
          console.error(`inova: login status poll failed for ${flow.sessionId}`, error);
        });
      }, pollMs);
    }
  }

  return {
    cancel,
    async start({ account, spec, file, baseEnv }) {
      const existing = flowsByAccount.get(account.id);
      if (existing !== undefined) cancel(existing);
      const [initialStatus, initialTimestamp] = await Promise.all([
        deps.checkStatus({ account, baseEnv }),
        hasFilePolling(account.provider)
          ? readTimestamp(account.provider, account.homeDir)
          : Promise.resolve(0),
      ]);
      const sessionId = deps.sessions.open({
        spec,
        file,
        accountId: account.id,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
      const flow: FlowState = {
        sessionId,
        account,
        baseEnv,
        stage: 'starting',
        buffer: '',
        authUrl: null,
        codePrompt: false,
        sentMethodEnter: false,
        sentTrustEnter: false,
        initialStatus,
        initialTimestamp,
        startedAt: Date.now(),
        settled: false,
        canceled: false,
        pollTimer: null,
        timeoutTimer: null,
        actionTimer: null,
      };
      flows.set(sessionId, flow);
      flowsByAccount.set(account.id, sessionId);
      emitState(flow, 'starting');
      startTimers(flow);
      return { sessionId, accountLabel: account.label, provider: account.provider };
    },
    submitCode({ sessionId, code }) {
      const flow = flows.get(sessionId);
      if (!flow || flow.settled) return false;
      const trimmed = code.trim();
      if (trimmed === '') return false;
      deps.sessions.write(sessionId, `${trimmed}\r`);
      return true;
    },
    handlePtyData(sessionId, chunk) {
      const flow = flows.get(sessionId);
      if (!flow || flow.settled) return;
      if (chunk.includes('\x1b[6n')) deps.sessions.write(sessionId, '\x1b[1;1R');
      if (chunk.includes('\x1b[c')) deps.sessions.write(sessionId, '\x1b[?62;c');

      const combined = flow.buffer + chunk;
      flow.buffer =
        combined.length > MAX_BUFFER_CHARS ? combined.slice(-MAX_BUFFER_CHARS) : combined;
      const clean = stripAnsi(flow.buffer);

      if (flow.account.provider === 'gemini') {
        if (
          !flow.sentMethodEnter &&
          /Select login method/i.test(clean) &&
          /Google OAuth/i.test(clean)
        ) {
          flow.sentMethodEnter = true;
          flow.actionTimer = setTimeout(() => {
            if (!flow.settled) deps.sessions.write(sessionId, '\r');
          }, methodDelayMs);
        }
        if (!flow.sentTrustEnter && /trust\s+(this\s+)?(folder|workspace)/i.test(clean)) {
          flow.sentTrustEnter = true;
          deps.sessions.write(sessionId, '\r');
        }
      }

      const foundUrl = extractAuthUrl(flow.buffer);
      const needsCode = /paste code here|enter.*code|c[oó]digo.*autoriza/i.test(clean);
      const browserHint = /opening browser|signing in|visit:|browser/i.test(clean);
      const urlChanged = foundUrl !== null && foundUrl !== flow.authUrl;
      const codeChanged = needsCode && !flow.codePrompt;

      if (foundUrl !== null) flow.authUrl = foundUrl;
      if (needsCode) flow.codePrompt = true;

      if (urlChanged || codeChanged || (flow.stage === 'starting' && browserHint)) {
        emitState(flow, 'waiting-auth');
      }
    },
    async handlePtyExit(sessionId) {
      const flow = flows.get(sessionId);
      if (!flow || flow.settled) return;
      cleanupFlow(flow);
      if (flow.canceled) {
        emitState(flow, 'canceled');
        return;
      }
      emitState(flow, 'verifying');
      const status = await deps.checkStatus({ account: flow.account, baseEnv: flow.baseEnv });
      if (status === 'logged-in') {
        deps.onAuthenticated?.(flow.account.id);
        emitState(flow, 'succeeded');
        return;
      }
      emitState(flow, 'failed', 'Não foi possível concluir a autenticação. Tente novamente.');
    },
  };
}
