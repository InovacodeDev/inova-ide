import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePullRequest, parseBranch } from './policy.mjs';

function flowPullRequest(overrides = {}) {
  return {
    headRef: 'feat/IDE-41-atalhos-mouse',
    isCrossRepository: false,
    labels: [],
    closingIssues: [],
    issue: null,
    title: 'feat: atalhos de mouse (IDE-41)',
    body: '',
    files: [
      { filename: 'src/core/shortcuts.ts', status: 'added' },
      { filename: 'src/core/shortcuts.contract.test.ts', status: 'added' },
      { filename: 'src/core/shortcuts.edge.test.ts', status: 'added' },
    ],
    ...overrides,
  };
}

function rules(pullRequest) {
  return evaluatePullRequest(pullRequest).map((violation) => violation.rule);
}

describe('fluxo de desenvolvimento: issue do InovaFlow', () => {
  it('aceita <tipo>/<CHAVE-N>-<slug> e extrai tipo e chave', () => {
    assert.deepEqual(parseBranch('feat/IDE-41-atalhos-mouse'), {
      kind: 'flow',
      type: 'feat',
      issueKey: 'IDE-41',
    });
  });

  it('aprova PR sem issue no GitHub quando cita a chave no título', () => {
    assert.deepEqual(evaluatePullRequest(flowPullRequest()), []);
  });

  it('aprova PR que cita a chave só na descrição', () => {
    const pullRequest = flowPullRequest({ title: 'feat: atalhos', body: 'InovaFlow: IDE-41' });
    assert.deepEqual(evaluatePullRequest(pullRequest), []);
  });

  it('rejeita PR que não cita a chave da branch', () => {
    assert.deepEqual(rules(flowPullRequest({ title: 'feat: atalhos' })), ['pr-missing-flow-issue']);
  });

  it('mantém os testes obrigatórios na branch do InovaFlow', () => {
    const files = [{ filename: 'src/core/shortcuts.ts', status: 'added' }];
    assert.deepEqual(rules(flowPullRequest({ files })), [
      'missing-contract-test',
      'missing-edge-test',
    ]);
  });

  it('mantém a imutabilidade dos contratos na branch do InovaFlow', () => {
    const files = [
      ...flowPullRequest().files,
      { filename: 'src/core/files.contract.test.ts', status: 'modified' },
    ];
    assert.deepEqual(rules(flowPullRequest({ files })), ['contract-test-changed']);
  });
});
