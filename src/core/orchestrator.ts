import type { OrchestratorVerdict } from './chat-types.js';
import { splitLeadingSlash } from './command-prompt.js';
import { isEffortLevel, PROVIDER_MODELS, type ModelOption, type ProviderModels } from './models.js';
import type { ProviderId, SessionOrchestratorConfig } from './types.js';

export const DEFAULT_ORCHESTRATOR_MAX_ROUNDS = 2;
export const MIN_ORCHESTRATOR_MAX_ROUNDS = 1;
export const MAX_ORCHESTRATOR_MAX_ROUNDS = 3;
export const MAX_ORCHESTRATOR_PLAN_CHARS = 16_000;
export const MAX_ORCHESTRATOR_DIFF_CHARS = 12_000;
export const DIRECT_GUIDANCE_MARKER = '[DIRECT_GUIDANCE]';
const MAX_MODEL_ID_CHARS = 200;

// REGEX: match disable keywords passed to `/orchestrator`
const DISABLE_KEYWORD_PATTERN = /^(off|disable|desativar|desligar|none|parar|stop)$/i;
// REGEX: match explicit separator between orchestrator and developer model arguments
const PAIR_SEPARATOR_PATTERN = /\s*(?:->|=>|→|,|;|\||\s\/\s)\s*/;
// REGEX: match standalone "cloud" dictation alias to replace with "claude"
const CLOUD_ALIAS_PATTERN = /\bcloud\b/gi;
// REGEX: validate a standalone custom model identifier without whitespace
const CUSTOM_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/;
// REGEX: parse verdict line emitted at the end of an orchestrator review turn
const VERDICT_LINE_PATTERN =
  /^\s*(?:\*\*|`)?VERDICT\s*:\s*(APPROVED|CHANGES_REQUESTED|CHANGES REQUESTED)(?:\*\*|`)?\s*$/gim;

export type OrchestratorSlashCommand =
  { kind: 'open-picker' } | { kind: 'disable' } | { kind: 'configure'; rawArgs: string };

export interface OrchestratorAccountCandidate {
  id: string;
  label: string;
  provider: ProviderId;
}

export interface ResolvedModelTarget {
  accountId: string;
  provider: ProviderId;
  modelId: string;
  displayLabel: string;
  custom: boolean;
}

export interface ResolvedOrchestratorPair {
  orchestrator: ResolvedModelTarget;
  developer: ResolvedModelTarget | null;
}

export function clampOrchestratorRounds(rounds: number | undefined): number {
  if (rounds === undefined || !Number.isFinite(rounds)) return DEFAULT_ORCHESTRATOR_MAX_ROUNDS;
  const whole = Math.trunc(rounds);
  if (whole < MIN_ORCHESTRATOR_MAX_ROUNDS) return MIN_ORCHESTRATOR_MAX_ROUNDS;
  if (whole > MAX_ORCHESTRATOR_MAX_ROUNDS) return MAX_ORCHESTRATOR_MAX_ROUNDS;
  return whole;
}

export function isValidOrchestratorRounds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_ORCHESTRATOR_MAX_ROUNDS &&
    value <= MAX_ORCHESTRATOR_MAX_ROUNDS
  );
}

function isSafeAccountId(id: string): boolean {
  return id !== '' && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\');
}

export function normalizeOrchestratorConfig(
  input: SessionOrchestratorConfig | null,
): SessionOrchestratorConfig | null {
  if (input === null) return null;
  const accountId = input.accountId.trim();
  if (!isSafeAccountId(accountId)) {
    throw new Error(`Invalid orchestrator accountId: ${input.accountId}`);
  }
  let model: string | null = null;
  if (input.model !== null) {
    const trimmed = input.model.trim();
    if (trimmed.length > MAX_MODEL_ID_CHARS) {
      throw new Error(`Orchestrator model must have at most ${MAX_MODEL_ID_CHARS} characters`);
    }
    model = trimmed === '' ? null : trimmed;
  }
  const effort = input.effort ?? null;
  if (effort !== null && !isEffortLevel(effort)) {
    throw new Error(`Invalid orchestrator effort: ${String(effort)}`);
  }
  return {
    enabled: Boolean(input.enabled),
    accountId,
    model,
    effort,
    maxRounds: clampOrchestratorRounds(input.maxRounds),
    providerSessionId: input.providerSessionId ?? null,
  };
}

export function parseOrchestratorSlashCommand(text: string): OrchestratorSlashCommand | null {
  const parsed = splitLeadingSlash(text.trim());
  if (parsed === null || parsed.name.toLowerCase() !== 'orchestrator') return null;
  const rest = parsed.rest.trim();
  if (rest === '') return { kind: 'open-picker' };
  if (DISABLE_KEYWORD_PATTERN.test(rest)) return { kind: 'disable' };
  return { kind: 'configure', rawArgs: rest };
}

function normalizeSearchText(value: string): string {
  const cleaned = value
    .normalize('NFD')
    // REGEX: strip combining diacritical marks after NFD normalization
    .replace(/[\u0300-\u036f]/g, '')
    .replace(CLOUD_ALIAS_PATTERN, 'claude')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return cleaned;
}

function effectiveCatalog(
  account: OrchestratorAccountCandidate,
  catalogsByAccount?: Readonly<Record<string, ProviderModels>>,
): readonly ModelOption[] {
  const base = PROVIDER_MODELS[account.provider].models;
  const custom = catalogsByAccount?.[account.id]?.models;
  if (!custom || custom.length === 0) return base;
  const seen = new Set(custom.map((item) => item.id));
  return [...custom, ...base.filter((item) => !seen.has(item.id))];
}

interface ScoredModelMatch {
  target: ResolvedModelTarget;
  score: number;
}

function scoreModelCandidate(input: {
  rawLower: string;
  normQuery: string;
  queryTokens: readonly string[];
  account: OrchestratorAccountCandidate;
  option: ModelOption;
  isActiveAccount: boolean;
}): number {
  const { rawLower, normQuery, queryTokens, account, option, isActiveAccount } = input;
  const normId = normalizeSearchText(option.id);
  const normLabel = normalizeSearchText(option.label);
  const normProvider = normalizeSearchText(account.provider);
  const normProviderLabel = `${normProvider} ${normLabel}`.trim();

  let score = 0;
  if (option.id.toLowerCase() === rawLower) {
    score = 120;
  } else if (normLabel === normQuery) {
    score = 110;
  } else if (normId === normQuery) {
    score = 108;
  } else if (normProviderLabel === normQuery) {
    score = 105;
  } else if (normProviderLabel.startsWith(`${normQuery} `)) {
    score = 100;
  } else if (normLabel.startsWith(`${normQuery} `)) {
    score = 92;
  } else {
    const idTokens = normId === '' ? [] : normId.split(' ');
    const labelTokens = normLabel === '' ? [] : normLabel.split(' ');
    const allTokens = new Set([...normProvider.split(' '), ...idTokens, ...labelTokens]);
    const allMatch =
      queryTokens.length > 0 &&
      queryTokens.every(
        (token) =>
          allTokens.has(token) ||
          (token.length >= 3 && [...allTokens].some((candidate) => candidate.startsWith(token))),
      );
    if (allMatch) {
      const overlap = queryTokens.length / Math.max(allTokens.size, queryTokens.length);
      score = 80 + Math.round(overlap * 10);
    } else if (normLabel.includes(normQuery) || normId.includes(normQuery)) {
      score = 65;
    }
  }

  if (score === 0) return 0;

  if (option.id.includes('orchestrator') && !queryTokens.includes('orchestrator')) {
    score -= 6;
  }
  if (queryTokens[0] === normProvider) {
    score += 4;
  }
  if (isActiveAccount) {
    score += 3;
  }
  return score;
}

function findBestCatalogMatch(input: {
  query: string;
  accounts: readonly OrchestratorAccountCandidate[];
  activeAccountId: string | null;
  catalogsByAccount?: Readonly<Record<string, ProviderModels>>;
  minScore?: number;
}): ScoredModelMatch | null {
  const trimmed = input.query.trim();
  if (trimmed === '' || input.accounts.length === 0) return null;
  const rawLower = trimmed.toLowerCase();
  const normQuery = normalizeSearchText(trimmed);
  if (normQuery === '') return null;
  const queryTokens = normQuery.split(' ').filter(Boolean);
  const minScore = input.minScore ?? 65;

  let best: ScoredModelMatch | null = null;
  for (const account of input.accounts) {
    const isActiveAccount = account.id === input.activeAccountId;
    for (const option of effectiveCatalog(account, input.catalogsByAccount)) {
      const score = scoreModelCandidate({
        rawLower,
        normQuery,
        queryTokens,
        account,
        option,
        isActiveAccount,
      });
      if (score < minScore) continue;
      if (!best || score > best.score) {
        best = {
          score,
          target: {
            accountId: account.id,
            provider: account.provider,
            modelId: option.id,
            displayLabel: option.label,
            custom: false,
          },
        };
      }
    }
  }
  return best;
}

function matchCustomModelFallback(input: {
  query: string;
  accounts: readonly OrchestratorAccountCandidate[];
  activeAccountId: string | null;
}): ResolvedModelTarget | null {
  const trimmed = input.query.trim();
  if (!CUSTOM_MODEL_ID_PATTERN.test(trimmed)) return null;
  const targetAccount =
    input.accounts.find((account) => account.id === input.activeAccountId) ?? input.accounts[0];
  if (!targetAccount) return null;
  return {
    accountId: targetAccount.id,
    provider: targetAccount.provider,
    modelId: trimmed,
    displayLabel: trimmed,
    custom: true,
  };
}

export function matchOrchestratorModel(input: {
  query: string;
  accounts: readonly OrchestratorAccountCandidate[];
  activeAccountId: string | null;
  catalogsByAccount?: Readonly<Record<string, ProviderModels>>;
  allowCustomFallback?: boolean;
}): ResolvedModelTarget | null {
  const matched = findBestCatalogMatch(input);
  if (matched) return matched.target;
  if (input.allowCustomFallback === false) return null;
  return matchCustomModelFallback(input);
}

export function resolveOrchestratorPair(input: {
  rawArgs: string;
  accounts: readonly OrchestratorAccountCandidate[];
  activeAccountId: string | null;
  catalogsByAccount?: Readonly<Record<string, ProviderModels>>;
}): ResolvedOrchestratorPair | null {
  const trimmed = input.rawArgs.trim();
  if (trimmed === '' || input.accounts.length === 0) return null;

  if (PAIR_SEPARATOR_PATTERN.test(trimmed)) {
    const parts = trimmed
      .split(PAIR_SEPARATOR_PATTERN)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (parts.length !== 2) return null;
    const orch = matchOrchestratorModel({
      query: parts[0]!,
      accounts: input.accounts,
      activeAccountId: input.activeAccountId,
      catalogsByAccount: input.catalogsByAccount,
      allowCustomFallback: true,
    });
    const dev = matchOrchestratorModel({
      query: parts[1]!,
      accounts: input.accounts,
      activeAccountId: input.activeAccountId,
      catalogsByAccount: input.catalogsByAccount,
      allowCustomFallback: true,
    });
    if (!orch || !dev) return null;
    return { orchestrator: orch, developer: dev };
  }

  const exactSingle = findBestCatalogMatch({
    query: trimmed,
    accounts: input.accounts,
    activeAccountId: input.activeAccountId,
    catalogsByAccount: input.catalogsByAccount,
    minScore: 95,
  });
  if (exactSingle) {
    return { orchestrator: exactSingle.target, developer: null };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    let bestPair: {
      orchestrator: ScoredModelMatch;
      developer: ScoredModelMatch;
      total: number;
    } | null = null;
    for (let split = 1; split < words.length; split += 1) {
      const leftQuery = words.slice(0, split).join(' ');
      const rightQuery = words.slice(split).join(' ');
      const leftMatch = findBestCatalogMatch({
        query: leftQuery,
        accounts: input.accounts,
        activeAccountId: input.activeAccountId,
        catalogsByAccount: input.catalogsByAccount,
        minScore: 80,
      });
      const rightMatch = findBestCatalogMatch({
        query: rightQuery,
        accounts: input.accounts,
        activeAccountId: input.activeAccountId,
        catalogsByAccount: input.catalogsByAccount,
        minScore: 80,
      });
      if (!leftMatch || !rightMatch) continue;
      const total = leftMatch.score + rightMatch.score;
      if (!bestPair || total > bestPair.total) {
        bestPair = { orchestrator: leftMatch, developer: rightMatch, total };
      }
    }
    if (bestPair) {
      return {
        orchestrator: bestPair.orchestrator.target,
        developer: bestPair.developer.target,
      };
    }
  }

  const single = matchOrchestratorModel({
    query: trimmed,
    accounts: input.accounts,
    activeAccountId: input.activeAccountId,
    catalogsByAccount: input.catalogsByAccount,
    allowCustomFallback: true,
  });
  if (!single) return null;
  return { orchestrator: single, developer: null };
}

function clipBlock(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

export function buildOrchestratorPlanPrompt(input: {
  userPrompt: string;
  developerLabel: string;
  contextPrefix?: string;
}): string {
  const context = input.contextPrefix?.trim() ?? '';
  const sections: string[] = [
    `Você atua como Orquestrador técnico em modo somente leitura, guiando o agente Desenvolvedor (${input.developerLabel}).`,
    'Se a solicitação for apenas uma pergunta ou explicação que não exija editar arquivos nem executar ações no repositório, responda diretamente ao usuário e inclua exatamente a linha [DIRECT_GUIDANCE] ao final da resposta.',
    'Caso a tarefa exija implementação, refatoração ou execução no código, inspecione o contexto necessário em modo leitura e escreva um plano técnico claro e objetivo para o Desenvolvedor: arquivos-alvo, passos concretos, casos de borda e verificações.',
  ];
  if (context !== '') {
    sections.push(`Contexto da sessão:\n${clipBlock(context, MAX_ORCHESTRATOR_PLAN_CHARS)}`);
  }
  sections.push(`Solicitação do usuário:\n${input.userPrompt.trim()}`);
  return sections.join('\n\n---\n\n');
}

export function buildDeveloperGuidedPrompt(input: {
  userPrompt: string;
  plan: string;
  round: number;
  maxRounds: number;
  feedback: string | null;
  contextPrefix?: string;
}): string {
  const context = input.contextPrefix?.trim() ?? '';
  const clippedPlan = clipBlock(input.plan, MAX_ORCHESTRATOR_PLAN_CHARS);
  if (input.round <= 1 || input.feedback === null || input.feedback.trim() === '') {
    const sections: string[] = [];
    if (context !== '') {
      sections.push(`Contexto da sessão:\n${clipBlock(context, MAX_ORCHESTRATOR_PLAN_CHARS)}`);
    }
    sections.push(
      `Execute a tarefa abaixo seguindo estritamente as orientações do Orquestrador (rodada ${input.round}/${input.maxRounds}). Ao concluir, execute as verificações pertinentes e resuma os arquivos alterados e resultados obtidos.`,
    );
    sections.push(`Plano e diretrizes do Orquestrador:\n${clippedPlan}`);
    sections.push(`Solicitação original do usuário:\n${input.userPrompt.trim()}`);
    return sections.join('\n\n---\n\n');
  }

  const clippedFeedback = clipBlock(input.feedback, MAX_ORCHESTRATOR_PLAN_CHARS);
  return [
    `Revisão do Orquestrador solicitou ajustes (rodada ${input.round}/${input.maxRounds}). Corrija todos os pontos apontados, valide novamente e relate o que foi corrigido.`,
    `Plano inicial do Orquestrador:\n${clippedPlan}`,
    `Feedback de revisão do Orquestrador:\n${clippedFeedback}`,
    `Solicitação original do usuário:\n${input.userPrompt.trim()}`,
  ].join('\n\n---\n\n');
}

export function buildOrchestratorReviewPrompt(input: {
  userPrompt: string;
  plan: string;
  developerReport: string;
  gitSummary: string;
  round: number;
  maxRounds: number;
}): string {
  const clippedPlan = clipBlock(input.plan, MAX_ORCHESTRATOR_PLAN_CHARS);
  const clippedReport = clipBlock(input.developerReport, MAX_ORCHESTRATOR_PLAN_CHARS);
  const clippedDiff = clipBlock(input.gitSummary, MAX_ORCHESTRATOR_DIFF_CHARS);
  const sections: string[] = [
    `Revise o trabalho realizado pelo Desenvolvedor na rodada ${input.round}/${input.maxRounds} (modo somente leitura). Verifique aderência ao pedido do usuário, correção técnica e regressões.`,
    `Solicitação original do usuário:\n${input.userPrompt.trim()}`,
    `Plano definido:\n${clippedPlan}`,
    `Relato do Desenvolvedor:\n${clippedReport === '' ? '(sem resposta textual)' : clippedReport}`,
    `Estado atual no Git:\n${clippedDiff === '' ? '(sem alterações detectadas no working tree)' : clippedDiff}`,
    'Termine sua resposta obrigatoriamente com uma linha final isolada no formato exato:\nVERDICT: APPROVED\nou\nVERDICT: CHANGES_REQUESTED\nCaso use VERDICT: CHANGES_REQUESTED, liste antes os ajustes objetivos necessários.',
  ];
  return sections.join('\n\n---\n\n');
}

export function hasDirectGuidanceMarker(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim().toUpperCase() === DIRECT_GUIDANCE_MARKER);
}

export function parseOrchestratorVerdict(text: string): OrchestratorVerdict {
  let lastMatch: string | null = null;
  for (const match of text.matchAll(VERDICT_LINE_PATTERN)) {
    const token = match[1];
    if (token) lastMatch = token.toUpperCase();
  }
  if (lastMatch === 'CHANGES_REQUESTED' || lastMatch === 'CHANGES REQUESTED') {
    return 'changes-requested';
  }
  return 'approved';
}
