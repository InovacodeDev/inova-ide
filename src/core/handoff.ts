import type { ChatEvent, UsageWindow } from './chat-types.js';
import type { Account, ProviderId, RateLimitFailoverPolicy } from './types.js';

export const DEFAULT_HANDOFF_MAX_CHARS = 12_000;

// REGEX: matches HTTP 429 and provider quota/rate-limit error strings across CLIs
const RATE_LIMIT_RE =
  /\b429\b|rate[-_ ]?limit|too many requests|usage limit|insufficient quota|quota exceeded|credit balance/i;

export function isRateLimitMessage(text: string): boolean {
  return RATE_LIMIT_RE.test(text);
}

// REGEX: matches provider CLI errors for a revoked, expired, or missing login (Claude 401 authentication_error, "/login" hints, Codex 401 Unauthorized, agy not logged in)
const AUTH_REVOKED_RE =
  /authentication_error|oauth token (?:has been )?(?:revoked|expired)|please run \/login|invalid api key|failed to authenticate|\b401 unauthorized\b|not logged into antigravity/i;

export function isAuthRevokedMessage(text: string): boolean {
  return AUTH_REVOKED_RE.test(text);
}

function clip(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function collectAssistantTexts(events: readonly ChatEvent[]): string[] {
  const blocks = new Map<string, string>();
  const order: string[] = [];
  for (const event of events) {
    if (event.kind === 'text-delta') {
      if (!blocks.has(event.blockId)) order.push(event.blockId);
      blocks.set(event.blockId, (blocks.get(event.blockId) ?? '') + event.text);
    } else if (event.kind === 'text') {
      if (!blocks.has(event.blockId)) order.push(event.blockId);
      blocks.set(event.blockId, event.text);
    }
  }
  return order.map((id) => (blocks.get(id) ?? '').trim()).filter((text) => text !== '');
}

function collectToolSummaries(events: readonly ChatEvent[]): string[] {
  const summaries: string[] = [];
  for (const event of events) {
    if (event.kind !== 'tool-use') continue;
    const firstLine = event.input.split('\n').find((line) => line.trim() !== '') ?? '';
    summaries.push(`- ${event.name}${firstLine ? `: ${clip(firstLine, 120)}` : ''}`);
  }
  return summaries.slice(-25);
}

function collectErrorsAndFailures(events: readonly ChatEvent[]): string[] {
  const items: string[] = [];
  for (const event of events) {
    if (event.kind === 'error') {
      items.push(`- Erro: ${clip(event.message, 400)}`);
    } else if (event.kind === 'verification' && event.status === 'failed') {
      for (const check of event.checks) {
        if (check.passed) continue;
        const output = check.output.trim();
        items.push(
          `- Verificação falhou (${check.command}): ${output ? clip(output, 400) : `exit ${check.exitCode ?? '?'}`}`,
        );
      }
    }
  }
  return items.slice(-6);
}

export function buildHandoffContext(input: {
  events: readonly ChatEvent[];
  gitSummary?: string;
  fromProvider: ProviderId;
  toProvider: ProviderId;
  maxChars?: number;
}): string {
  const maxChars = Math.max(200, input.maxChars ?? DEFAULT_HANDOFF_MAX_CHARS);
  const userMessages = input.events
    .filter((event): event is Extract<ChatEvent, { kind: 'user' }> => event.kind === 'user')
    .map((event) => event.text.trim())
    .filter((text) => text !== '');
  const assistantTexts = collectAssistantTexts(input.events);
  const toolSummaries = collectToolSummaries(input.events);
  const errors = collectErrorsAndFailures(input.events);

  const sections: string[] = [`[Contexto de handoff: ${input.fromProvider} → ${input.toProvider}]`];

  if (userMessages.length > 0) {
    const first = clip(userMessages[0]!, Math.floor(maxChars * 0.25));
    const followUps = userMessages
      .slice(1)
      .slice(-5)
      .map((msg) => `- ${clip(msg, 300)}`);
    sections.push(
      followUps.length > 0
        ? `## Objetivo original\n${first}\n\n## Pedidos seguintes\n${followUps.join('\n')}`
        : `## Objetivo original\n${first}`,
    );
  }

  if (assistantTexts.length > 0 || toolSummaries.length > 0) {
    const parts: string[] = [];
    if (assistantTexts.length > 0) {
      parts.push(
        assistantTexts
          .slice(-3)
          .map((text) => clip(text, Math.floor(maxChars * 0.2)))
          .join('\n\n'),
      );
    }
    if (toolSummaries.length > 0) {
      parts.push(`Ferramentas usadas:\n${toolSummaries.join('\n')}`);
    }
    sections.push(`## Progresso realizado\n${parts.join('\n\n')}`);
  }

  if (input.gitSummary && input.gitSummary.trim() !== '') {
    sections.push(`## Estado Git atual\n${clip(input.gitSummary, Math.floor(maxChars * 0.2))}`);
  }

  if (errors.length > 0) {
    sections.push(`## Pendências e erros\n${errors.join('\n')}`);
  }

  const combined = sections.join('\n\n');
  return clip(combined, maxChars);
}

export interface TruncatedTranscript {
  kept: ChatEvent[];
  removedUserText: string;
  checkpointRef: string | null;
  skippedLargeFiles: string[];
}

export function truncateTranscriptAtTurn(
  events: readonly ChatEvent[],
  turnIndex: number,
): TruncatedTranscript | null {
  const userIndices: number[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.kind === 'user') userIndices.push(i);
  }
  const userPos = userIndices[turnIndex];
  if (userPos === undefined) return null;
  const userEvent = events[userPos];
  if (userEvent?.kind !== 'user') return null;
  const prevEvent = userPos > 0 ? events[userPos - 1] : undefined;
  const hasCheckpoint = prevEvent?.kind === 'checkpoint';
  const cut = hasCheckpoint ? userPos - 1 : userPos;
  const earlierFeedback = events
    .slice(cut)
    .filter((event) => event.kind === 'feedback' && event.turnIndex < turnIndex);
  return {
    kept: [...events.slice(0, cut), ...earlierFeedback],
    removedUserText: userEvent.text,
    checkpointRef: hasCheckpoint ? prevEvent.ref : null,
    skippedLargeFiles: hasCheckpoint ? [...prevEvent.skippedLargeFiles] : [],
  };
}

export interface SlicedTranscript {
  slicedEvents: ChatEvent[];
  preTurnCheckpointRef: string | null;
  postTurnCheckpointRef: string | null;
  isLatestTurn: boolean;
}

export function sliceTranscriptToTurn(
  events: readonly ChatEvent[],
  turnIndex: number,
): SlicedTranscript {
  const userIndices: number[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.kind === 'user') userIndices.push(i);
  }
  if (userIndices.length === 0) {
    return {
      slicedEvents: [...events],
      preTurnCheckpointRef: null,
      postTurnCheckpointRef: null,
      isLatestTurn: true,
    };
  }
  const boundedTurn = Math.max(0, Math.min(turnIndex, userIndices.length - 1));
  const targetUserPos = userIndices[boundedTurn]!;
  const prevEvent = targetUserPos > 0 ? events[targetUserPos - 1] : undefined;
  const preTurnCheckpointRef = prevEvent?.kind === 'checkpoint' ? prevEvent.ref : null;
  const isLatestTurn = boundedTurn === userIndices.length - 1;

  if (isLatestTurn) {
    return {
      slicedEvents: [...events],
      preTurnCheckpointRef,
      postTurnCheckpointRef: null,
      isLatestTurn: true,
    };
  }

  const nextUserPos = userIndices[boundedTurn + 1]!;
  const beforeNextUser = nextUserPos > 0 ? events[nextUserPos - 1] : undefined;
  const hasPostCheckpoint = beforeNextUser?.kind === 'checkpoint';
  const cutEnd = hasPostCheckpoint ? nextUserPos - 1 : nextUserPos;
  return {
    slicedEvents: events.slice(0, cutEnd),
    preTurnCheckpointRef,
    postTurnCheckpointRef: hasPostCheckpoint ? beforeNextUser.ref : null,
    isLatestTurn: false,
  };
}

const PRIMARY_FAILOVER_PROVIDERS: ReadonlySet<ProviderId> = new Set(['claude', 'codex', 'gemini']);

export function peakUsagePercent(windows: readonly UsageWindow[]): number {
  let peak = 0;
  for (const window of windows) {
    if (Number.isFinite(window.usedPercent) && window.usedPercent > peak) {
      peak = window.usedPercent;
    }
  }
  return peak;
}

function providerFailoverTier(provider: ProviderId, currentProvider: ProviderId): number {
  if (provider === currentProvider) return 0;
  if (PRIMARY_FAILOVER_PROVIDERS.has(provider)) return 1;
  return 2;
}

export interface SelectFailoverAccountInput {
  policy: RateLimitFailoverPolicy;
  currentAccountId: string;
  currentProvider: ProviderId;
  accounts: readonly Account[];
  busyAccountIds?: ReadonlySet<string>;
  exhaustedAccountIds?: ReadonlySet<string>;
  expiredAccountIds?: ReadonlySet<string>;
  triedAccountIds?: ReadonlySet<string>;
  usageByAccount?: ReadonlyMap<string, readonly UsageWindow[]>;
}

export function rankFailoverAccounts(input: SelectFailoverAccountInput): Account[] {
  const {
    policy,
    currentAccountId,
    currentProvider,
    accounts,
    busyAccountIds,
    exhaustedAccountIds,
    expiredAccountIds,
    triedAccountIds,
    usageByAccount,
  } = input;
  if (policy === 'off') return [];

  const eligible = accounts
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => {
      if (account.id === currentAccountId) return false;
      if (policy === 'same-provider' && account.provider !== currentProvider) return false;
      if (exhaustedAccountIds?.has(account.id)) return false;
      if (expiredAccountIds?.has(account.id)) return false;
      if (triedAccountIds?.has(account.id)) return false;
      return true;
    });

  eligible.sort((a, b) => {
    const tierDiff =
      providerFailoverTier(a.account.provider, currentProvider) -
      providerFailoverTier(b.account.provider, currentProvider);
    if (tierDiff !== 0) return tierDiff;

    const busyDiff =
      (busyAccountIds?.has(a.account.id) ? 1 : 0) - (busyAccountIds?.has(b.account.id) ? 1 : 0);
    if (busyDiff !== 0) return busyDiff;

    const peakDiff =
      peakUsagePercent(usageByAccount?.get(a.account.id) ?? []) -
      peakUsagePercent(usageByAccount?.get(b.account.id) ?? []);
    if (peakDiff !== 0) return peakDiff;

    return a.index - b.index;
  });

  return eligible.map(({ account }) => account);
}

export function selectFailoverAccount(input: SelectFailoverAccountInput): Account | null {
  return rankFailoverAccounts(input)[0] ?? null;
}

export const MAX_PINNED_MEMORY_CHARS = 4_000;

export function formatPinnedMemoryBlock(input: {
  projectMemory?: string | null;
  sessionMemory?: string | null;
}): string | null {
  const projectText = input.projectMemory?.trim() ?? '';
  const sessionText = input.sessionMemory?.trim() ?? '';
  if (projectText === '' && sessionText === '') return null;
  const sections = [
    'Memória fixada (regras, decisões e restrições ativas — respeite em toda resposta):',
  ];
  if (projectText !== '') sections.push(`### Projeto\n${projectText}`);
  if (sessionText !== '') sections.push(`### Sessão\n${sessionText}`);
  return sections.join('\n\n');
}

export function hashPinnedMemory(block: string | null): string | null {
  if (block === null || block.trim() === '') return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < block.length; i += 1) {
    hash ^= block.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const MAX_REVIEW_DIFF_CHARS = 32_000;

export interface SelectReviewAccountInput {
  currentAccountId: string;
  currentProvider: ProviderId;
  accounts: readonly Account[];
  busyAccountIds?: ReadonlySet<string>;
  exhaustedAccountIds?: ReadonlySet<string>;
  expiredAccountIds?: ReadonlySet<string>;
  usageByAccount?: ReadonlyMap<string, readonly UsageWindow[]>;
}

function reviewProviderRank(provider: ProviderId, currentProvider: ProviderId): number {
  if (provider !== currentProvider) {
    return PRIMARY_FAILOVER_PROVIDERS.has(provider) ? 0 : 1;
  }
  return 2;
}

export function rankReviewAccounts(input: SelectReviewAccountInput): Account[] {
  const {
    currentAccountId,
    currentProvider,
    accounts,
    busyAccountIds = new Set<string>(),
    exhaustedAccountIds = new Set<string>(),
    expiredAccountIds = new Set<string>(),
    usageByAccount = new Map<string, readonly UsageWindow[]>(),
  } = input;

  return accounts
    .filter(
      (account) =>
        account.id !== currentAccountId &&
        !busyAccountIds.has(account.id) &&
        !exhaustedAccountIds.has(account.id) &&
        !expiredAccountIds.has(account.id),
    )
    .sort((left, right) => {
      const rankDiff =
        reviewProviderRank(left.provider, currentProvider) -
        reviewProviderRank(right.provider, currentProvider);
      if (rankDiff !== 0) return rankDiff;
      return (
        peakUsagePercent(usageByAccount.get(left.id) ?? []) -
        peakUsagePercent(usageByAccount.get(right.id) ?? [])
      );
    });
}

export function selectReviewAccount(input: SelectReviewAccountInput): Account | null {
  const ranked = rankReviewAccounts(input);
  if (ranked.length > 0) {
    return ranked[0] ?? null;
  }

  return (
    input.accounts.find((account) => account.id === input.currentAccountId) ??
    input.accounts[0] ??
    null
  );
}

export interface AdversarialReviewPromptInput {
  branch: string;
  changedFiles: readonly string[];
  diffStat: string;
  diff: string;
  maxDiffChars?: number;
}

export function buildAdversarialReviewPrompt(input: AdversarialReviewPromptInput): string {
  const maxDiffChars = input.maxDiffChars ?? MAX_REVIEW_DIFF_CHARS;
  const filesList =
    input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`).join('\n')
      : '- (nenhum arquivo listado)';
  const diffStat = input.diffStat.trim() || '(sem estatística)';
  const diff =
    clip(input.diff, maxDiffChars) ||
    '(sem diff textual; inspecione os arquivos alterados no repositório)';

  return [
    'Você é um revisor de código adversarial independente.',
    'Esta sessão está em contexto limpo e modo somente-leitura/plano. NÃO edite arquivos nem crie commits.',
    'Inspecione as alterações abaixo (e leia os arquivos completos no repositório quando necessário) em busca de:',
    '1. Bugs de lógica, condições de corrida, casos de borda e regressões.',
    '2. Falhas de segurança, validação de entrada, vazamento de dados ou quebra de contrato/API.',
    '3. Violações de arquitetura, duplicação, código morto ou cobertura de testes ausente.',
    '',
    'Para cada achado, informe severidade (`CRÍTICO`, `ALTO`, `MÉDIO` ou `BAIXO`), arquivo/linha e evidência objetiva.',
    'Se não houver problemas relevantes após verificação real, declare explicitamente "Sem achados críticos ou altos" e aponte riscos residuais.',
    '',
    `Branch: ${input.branch}`,
    '',
    'Arquivos alterados:',
    filesList,
    '',
    'Resumo do diff:',
    '```',
    diffStat,
    '```',
    '',
    'Diff atual:',
    '```diff',
    diff,
    '```',
  ].join('\n');
}

export function buildParentFixPrompt(findings: string): string {
  return [
    'Um revisor independente analisou o diff atual e reportou os achados abaixo.',
    'Verifique cada achado contra o código real, corrija os problemas procedimentais válidos e rode os testes relevantes:',
    '',
    findings.trim(),
  ].join('\n');
}
