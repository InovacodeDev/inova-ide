import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addAccount } from './accounts.js';
import {
  buildDeveloperGuidedPrompt,
  buildOrchestratorReviewPrompt,
  clampOrchestratorRounds,
  MAX_ORCHESTRATOR_DIFF_CHARS,
  MAX_ORCHESTRATOR_PLAN_CHARS,
  normalizeOrchestratorConfig,
  resolveOrchestratorPair,
  type OrchestratorAccountCandidate,
} from './orchestrator.js';
import { bindProject } from './projects.js';
import { createSession, SessionError, updateSession } from './sessions.js';
import { loadStore, StoreCorruptError } from './store.js';

const tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-orch-edge-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('orchestrator edge cases', () => {
  it('rejects corrupt Session.orchestrator shapes during loadStore', async () => {
    const cases: Record<string, unknown>[] = [
      { enabled: 'yes', accountId: 'acc-1', model: null },
      { enabled: true, accountId: '../escape', model: null },
      { enabled: true, accountId: 'acc-1', model: 'opus', maxRounds: 0 },
      { enabled: true, accountId: 'acc-1', model: 'opus', maxRounds: 99 },
      { enabled: true, accountId: 'acc-1', model: 'opus', effort: 'ultra' },
      { enabled: true, accountId: 'acc-1', model: 123 },
    ];

    for (const invalidOrch of cases) {
      const root = await tmp();
      const projectPath = await tmp();
      const acc = await addAccount({ root, provider: 'claude', label: 'pessoal' });
      const project = await bindProject({ root, path: projectPath, accountLabel: acc.label });
      const session = await createSession({ root, projectId: project.id });
      const storeFile = join(root, 'store.json');
      const raw = JSON.parse(await readFile(storeFile, 'utf8')) as {
        sessions: Record<string, unknown>[];
      };
      raw.sessions = raw.sessions.map((item) =>
        item['id'] === session.id ? { ...item, orchestrator: invalidOrch } : item,
      );
      await writeFile(storeFile, JSON.stringify(raw, null, 2));
      await expect(loadStore(root)).rejects.toThrow(StoreCorruptError);
    }
  });

  it('rejects unsafe orchestrator configuration when creating or updating a session', async () => {
    const root = await tmp();
    const projectPath = await tmp();
    const acc = await addAccount({ root, provider: 'claude', label: 'pessoal' });
    const project = await bindProject({ root, path: projectPath, accountLabel: acc.label });
    const session = await createSession({ root, projectId: project.id });

    await expect(
      updateSession({
        root,
        sessionId: session.id,
        patch: {
          orchestrator: {
            enabled: true,
            accountId: '../bad',
            model: 'opus',
          },
        },
      }),
    ).rejects.toBeInstanceOf(SessionError);

    expect(
      normalizeOrchestratorConfig({
        enabled: true,
        accountId: acc.id,
        model: '   ',
        maxRounds: 10,
      }),
    ).toEqual({
      enabled: true,
      accountId: acc.id,
      model: null,
      effort: null,
      maxRounds: 3,
      providerSessionId: null,
    });
  });

  it('clamps round counts and truncates oversized plans and diffs', () => {
    expect(clampOrchestratorRounds(undefined)).toBe(2);
    expect(clampOrchestratorRounds(Number.NaN)).toBe(2);
    expect(clampOrchestratorRounds(0)).toBe(1);
    expect(clampOrchestratorRounds(-5)).toBe(1);
    expect(clampOrchestratorRounds(10)).toBe(3);

    const hugePlan = 'P'.repeat(MAX_ORCHESTRATOR_PLAN_CHARS + 500);
    const hugeDiff = 'D'.repeat(MAX_ORCHESTRATOR_DIFF_CHARS + 500);
    const devPrompt = buildDeveloperGuidedPrompt({
      userPrompt: 'ok',
      plan: hugePlan,
      round: 1,
      maxRounds: 2,
      feedback: null,
    });
    expect(devPrompt).not.toContain(hugePlan);
    expect(devPrompt.length).toBeLessThan(MAX_ORCHESTRATOR_PLAN_CHARS + 500);

    const reviewPrompt = buildOrchestratorReviewPrompt({
      userPrompt: 'ok',
      plan: hugePlan,
      developerReport: hugePlan,
      gitSummary: hugeDiff,
      round: 1,
      maxRounds: 2,
    });
    expect(reviewPrompt).not.toContain(hugeDiff);
  });

  it('handles slash-containing model IDs, empty args, and unrecognized multi-word strings cleanly', () => {
    const accounts: readonly OrchestratorAccountCandidate[] = [
      { id: 'acc-oc', label: 'zen', provider: 'opencode' },
      { id: 'acc-gem', label: 'gem', provider: 'gemini' },
    ];

    const opencodePair = resolveOrchestratorPair({
      rawArgs: 'opencode/claude-opus-5-5 -> opencode/claude-sonnet-5-5',
      accounts,
      activeAccountId: 'acc-oc',
    });
    expect(opencodePair?.orchestrator).toMatchObject({
      accountId: 'acc-oc',
      modelId: 'opencode/claude-opus-5-5',
    });
    expect(opencodePair?.developer).toMatchObject({
      accountId: 'acc-oc',
      modelId: 'opencode/claude-sonnet-5-5',
    });

    expect(
      resolveOrchestratorPair({
        rawArgs: '   ',
        accounts,
        activeAccountId: 'acc-gem',
      }),
    ).toBeNull();

    expect(
      resolveOrchestratorPair({
        rawArgs: 'modelo desconhecido completamente invalido',
        accounts,
        activeAccountId: 'acc-gem',
      }),
    ).toBeNull();
  });
});
