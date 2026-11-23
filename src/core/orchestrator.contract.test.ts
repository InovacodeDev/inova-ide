import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addAccount } from './accounts.js';
import {
  buildDeveloperGuidedPrompt,
  buildOrchestratorPlanPrompt,
  buildOrchestratorReviewPrompt,
  hasDirectGuidanceMarker,
  parseOrchestratorSlashCommand,
  parseOrchestratorVerdict,
  resolveOrchestratorPair,
  type OrchestratorAccountCandidate,
} from './orchestrator.js';
import { bindProject } from './projects.js';
import { createSession, updateSession } from './sessions.js';
import { nativeSlashCommands } from './slash-commands.js';
import { loadStore } from './store.js';
import type { ProviderId } from './types.js';

const PROVIDERS: readonly ProviderId[] = [
  'claude',
  'codex',
  'gemini',
  'deepseek',
  'kimi',
  'grok',
  'qwen',
  'opencode',
];

const tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-orch-core-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SAMPLE_ACCOUNTS: readonly OrchestratorAccountCandidate[] = [
  { id: 'acc-gemini', label: 'google-main', provider: 'gemini' },
  { id: 'acc-claude', label: 'anthropic-main', provider: 'claude' },
  { id: 'acc-codex', label: 'openai-main', provider: 'codex' },
];

describe('orchestrator core contract', () => {
  it('exposes /orchestrator command across all 8 providers', () => {
    for (const provider of PROVIDERS) {
      expect(nativeSlashCommands(provider), provider).toContainEqual({
        name: 'orchestrator',
        description: 'Define um modelo orquestrador para guiar esta sessão',
        action: 'orchestrator',
      });
    }
  });

  it('parses /orchestrator command variants and ignores unrelated prompts', () => {
    expect(parseOrchestratorSlashCommand('/orchestrator')).toEqual({ kind: 'open-picker' });
    expect(parseOrchestratorSlashCommand('  /orchestrator   ')).toEqual({ kind: 'open-picker' });
    expect(parseOrchestratorSlashCommand('/orchestrator off')).toEqual({ kind: 'disable' });
    expect(parseOrchestratorSlashCommand('/orchestrator desativar')).toEqual({ kind: 'disable' });
    expect(
      parseOrchestratorSlashCommand('/orchestrator Gemini 4 Neon -> Gemini 4 Hydrogen'),
    ).toEqual({
      kind: 'configure',
      rawArgs: 'Gemini 4 Neon -> Gemini 4 Hydrogen',
    });
    expect(parseOrchestratorSlashCommand('/model')).toBeNull();
    expect(parseOrchestratorSlashCommand('implemente o endpoint')).toBeNull();
  });

  it('resolves same-provider, dictation aliases, cross-provider, single, and custom pairs', () => {
    const geminiExplicit = resolveOrchestratorPair({
      rawArgs: 'Gemini 4 Neon -> Gemini 4 Hydrogen',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-gemini',
    });
    expect(geminiExplicit?.orchestrator).toMatchObject({
      accountId: 'acc-gemini',
      provider: 'gemini',
      modelId: 'gemini-4-neon',
    });
    expect(geminiExplicit?.developer).toMatchObject({
      accountId: 'acc-gemini',
      provider: 'gemini',
      modelId: 'gemini-4-hydrogen',
    });

    const geminiSpaced = resolveOrchestratorPair({
      rawArgs: 'Gemini 4 Neon Gemini 4 Hydrogen',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-gemini',
    });
    expect(geminiSpaced?.orchestrator.modelId).toBe('gemini-4-neon');
    expect(geminiSpaced?.developer?.modelId).toBe('gemini-4-hydrogen');

    const claudeDictation = resolveOrchestratorPair({
      rawArgs: 'Cloud Opus Cloud Sonnet',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-claude',
    });
    expect(claudeDictation?.orchestrator).toMatchObject({
      accountId: 'acc-claude',
      provider: 'claude',
      modelId: 'opus',
    });
    expect(claudeDictation?.developer).toMatchObject({
      accountId: 'acc-claude',
      provider: 'claude',
      modelId: 'sonnet',
    });

    const shortClaudePair = resolveOrchestratorPair({
      rawArgs: 'opus sonnet',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-claude',
    });
    expect(shortClaudePair?.orchestrator.modelId).toBe('opus');
    expect(shortClaudePair?.developer?.modelId).toBe('sonnet');

    const crossProvider = resolveOrchestratorPair({
      rawArgs: 'Gemini 4 Neon -> Claude Sonnet',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-gemini',
    });
    expect(crossProvider?.orchestrator).toMatchObject({
      accountId: 'acc-gemini',
      modelId: 'gemini-4-neon',
    });
    expect(crossProvider?.developer).toMatchObject({
      accountId: 'acc-claude',
      modelId: 'sonnet',
    });

    const claudeToCodex = resolveOrchestratorPair({
      rawArgs: 'Claude Opus -> GPT 6.2 Sol',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-claude',
    });
    expect(claudeToCodex?.orchestrator).toMatchObject({
      accountId: 'acc-claude',
      modelId: 'opus',
    });
    expect(claudeToCodex?.developer).toMatchObject({
      accountId: 'acc-codex',
      modelId: 'gpt-6.2-sol',
    });

    const singleOnly = resolveOrchestratorPair({
      rawArgs: 'Gemini 4 Neon',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-claude',
    });
    expect(singleOnly?.orchestrator).toMatchObject({
      accountId: 'acc-gemini',
      modelId: 'gemini-4-neon',
    });
    expect(singleOnly?.developer).toBeNull();

    const customFallback = resolveOrchestratorPair({
      rawArgs: 'claude-custom-preview',
      accounts: SAMPLE_ACCOUNTS,
      activeAccountId: 'acc-claude',
    });
    expect(customFallback?.orchestrator).toMatchObject({
      accountId: 'acc-claude',
      modelId: 'claude-custom-preview',
      custom: true,
    });
    expect(customFallback?.developer).toBeNull();
  });

  it('builds structured prompts and parses direct guidance and review verdicts', () => {
    const planPrompt = buildOrchestratorPlanPrompt({
      userPrompt: 'Adicione paginação no endpoint',
      developerLabel: 'Sonnet 5.5',
      contextPrefix: 'Projeto usa Vitest.',
    });
    expect(planPrompt).toContain('[DIRECT_GUIDANCE]');
    expect(planPrompt).toContain('Sonnet 5.5');
    expect(planPrompt).toContain('Projeto usa Vitest.');

    const roundOneDev = buildDeveloperGuidedPrompt({
      userPrompt: 'Adicione paginação',
      plan: 'Passo 1: validar cursor.',
      round: 1,
      maxRounds: 2,
      feedback: null,
    });
    expect(roundOneDev).toContain('Passo 1: validar cursor.');
    expect(roundOneDev).toContain('rodada 1/2');

    const reviewPrompt = buildOrchestratorReviewPrompt({
      userPrompt: 'Adicione paginação',
      plan: 'Passo 1: validar cursor.',
      developerReport: 'Implementado.',
      gitSummary: 'diff --git a/x b/x',
      round: 1,
      maxRounds: 2,
    });
    expect(reviewPrompt).toContain('VERDICT: APPROVED');
    expect(reviewPrompt).toContain('VERDICT: CHANGES_REQUESTED');

    expect(hasDirectGuidanceMarker('Resposta direta.\n[DIRECT_GUIDANCE]\n')).toBe(true);
    expect(hasDirectGuidanceMarker('Precisa editar arquivos.')).toBe(false);

    expect(parseOrchestratorVerdict('Tudo ok.\nVERDICT: APPROVED')).toBe('approved');
    expect(parseOrchestratorVerdict('Faltou teste.\n**VERDICT: CHANGES_REQUESTED**')).toBe(
      'changes-requested',
    );
    expect(
      parseOrchestratorVerdict('VERDICT: CHANGES_REQUESTED\nRevisão final:\nVERDICT: APPROVED'),
    ).toBe('approved');
    expect(parseOrchestratorVerdict('Resposta sem marcador explícito.')).toBe('approved');
  });

  it('persists Session.orchestrator across store reloads and resets providerSessionId only when target changes', async () => {
    const root = await tmp();
    const projectPath = await tmp();
    const accA = await addAccount({ root, provider: 'gemini', label: 'gem' });
    const accB = await addAccount({ root, provider: 'claude', label: 'cla' });
    const project = await bindProject({ root, path: projectPath, accountLabel: accB.label });
    const created = await createSession({
      root,
      projectId: project.id,
      orchestrator: {
        enabled: true,
        accountId: accA.id,
        model: 'gemini-4-neon',
        effort: 'high',
        maxRounds: 2,
        providerSessionId: 'orch-sess-1',
      },
    });
    expect(created.orchestrator).toEqual({
      enabled: true,
      accountId: accA.id,
      model: 'gemini-4-neon',
      effort: 'high',
      maxRounds: 2,
      providerSessionId: 'orch-sess-1',
    });

    const sameTargetUpdate = await updateSession({
      root,
      sessionId: created.id,
      patch: {
        orchestrator: {
          enabled: true,
          accountId: accA.id,
          model: 'gemini-4-neon',
          effort: 'medium',
          maxRounds: 3,
        },
      },
    });
    expect(sameTargetUpdate.orchestrator?.providerSessionId).toBe('orch-sess-1');
    expect(sameTargetUpdate.orchestrator?.maxRounds).toBe(3);

    const changedModelUpdate = await updateSession({
      root,
      sessionId: created.id,
      patch: {
        orchestrator: {
          enabled: true,
          accountId: accA.id,
          model: 'gemini-4-argon',
          maxRounds: 2,
        },
      },
    });
    expect(changedModelUpdate.orchestrator?.providerSessionId).toBeNull();

    const loaded = await loadStore(root);
    expect(loaded.sessions?.[0]?.orchestrator).toEqual({
      enabled: true,
      accountId: accA.id,
      model: 'gemini-4-argon',
      effort: null,
      maxRounds: 2,
      providerSessionId: null,
    });
  });
});
