import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LABELS,
  evaluatePullRequest,
  findCommitsWithoutMergedPullRequest,
  parseBranch,
} from './policy.mjs';

function taskIssue(overrides = {}) {
  return {
    state: 'OPEN',
    labels: [LABELS.task],
    parent: { number: 10, labels: [LABELS.demand] },
    linkedBranches: ['feat/12-file-viewer'],
    ...overrides,
  };
}

function featurePullRequest(overrides = {}) {
  return {
    headRef: 'feat/12-file-viewer',
    isCrossRepository: false,
    labels: [],
    closingIssues: [12],
    issue: taskIssue(),
    files: [
      { filename: 'src/core/file-viewer.ts', status: 'added' },
      { filename: 'src/core/file-viewer.contract.test.ts', status: 'added' },
      { filename: 'src/core/file-viewer.edge.test.ts', status: 'added' },
    ],
    ...overrides,
  };
}

function rules(pullRequest) {
  return evaluatePullRequest(pullRequest).map((violation) => violation.rule);
}

describe('fluxo de desenvolvimento: branch', () => {
  it('aceita <tipo>/<issue>-<slug> e extrai tipo e issue', () => {
    assert.deepEqual(parseBranch('feat/12-file-viewer'), {
      kind: 'task',
      type: 'feat',
      issueNumber: 12,
    });
  });

  it('aceita release/vX.Y.Z sem issue', () => {
    assert.deepEqual(parseBranch('release/v1.2.3'), { kind: 'release', type: 'release' });
  });

  it('rejeita branch sem número de issue', () => {
    assert.deepEqual(rules(featurePullRequest({ headRef: 'feat/file-viewer' })), ['branch-name']);
  });
});

describe('fluxo de desenvolvimento: issue da tarefa', () => {
  it('aprova PR de tarefa que cumpre todo o fluxo', () => {
    assert.deepEqual(evaluatePullRequest(featurePullRequest()), []);
  });

  it('rejeita branch que aponta para issue inexistente', () => {
    assert.deepEqual(rules(featurePullRequest({ issue: null })), ['issue-not-found']);
  });

  it('rejeita issue sem a label de tarefa', () => {
    assert.deepEqual(rules(featurePullRequest({ issue: taskIssue({ labels: [] }) })), [
      'issue-not-task',
    ]);
  });

  it('rejeita tarefa que não é sub-issue', () => {
    assert.deepEqual(rules(featurePullRequest({ issue: taskIssue({ parent: null }) })), [
      'task-without-demand',
    ]);
  });

  it('rejeita tarefa cuja issue pai não é uma demanda', () => {
    const issue = taskIssue({ parent: { number: 10, labels: [] } });
    assert.deepEqual(rules(featurePullRequest({ issue })), ['parent-not-demand']);
  });

  it('rejeita branch não vinculada à issue', () => {
    const issue = taskIssue({ linkedBranches: [] });
    assert.deepEqual(rules(featurePullRequest({ issue })), ['branch-not-linked']);
  });

  it('rejeita PR que não fecha a issue da branch', () => {
    assert.deepEqual(rules(featurePullRequest({ closingIssues: [] })), ['pr-does-not-close-issue']);
  });
});

describe('fluxo de desenvolvimento: testes obrigatórios', () => {
  it('feat exige um teste de contrato novo', () => {
    const files = [
      { filename: 'src/core/file-viewer.ts', status: 'added' },
      { filename: 'src/core/file-viewer.edge.test.ts', status: 'added' },
    ];
    assert.deepEqual(rules(featurePullRequest({ files })), ['missing-contract-test']);
  });

  it('feat exige um teste de cenários de bug', () => {
    const files = [
      { filename: 'src/core/file-viewer.ts', status: 'added' },
      { filename: 'src/core/file-viewer.contract.test.ts', status: 'added' },
    ];
    assert.deepEqual(rules(featurePullRequest({ files })), ['missing-edge-test']);
  });

  it('fix exige um teste de cenários de bug', () => {
    const pullRequest = featurePullRequest({
      headRef: 'fix/12-crash-on-empty-file',
      issue: taskIssue({ linkedBranches: ['fix/12-crash-on-empty-file'] }),
      files: [{ filename: 'src/core/files.ts', status: 'modified' }],
    });
    assert.deepEqual(rules(pullRequest), ['missing-edge-test']);
  });

  it('branch docs não pode alterar código de produção', () => {
    const pullRequest = featurePullRequest({
      headRef: 'docs/12-readme',
      issue: taskIssue({ linkedBranches: ['docs/12-readme'] }),
      files: [{ filename: 'src/core/files.ts', status: 'modified' }],
    });
    assert.deepEqual(rules(pullRequest), ['production-code-in-non-code-branch']);
  });
});

describe('fluxo de desenvolvimento: testes de contrato são imutáveis', () => {
  const existingContract = { filename: 'src/core/files.contract.test.ts', status: 'modified' };

  it('rejeita alteração de teste de contrato existente', () => {
    const files = [...featurePullRequest().files, existingContract];
    assert.deepEqual(rules(featurePullRequest({ files })), ['contract-test-changed']);
  });

  it('rejeita remoção de teste de contrato existente', () => {
    const files = [...featurePullRequest().files, { ...existingContract, status: 'removed' }];
    assert.deepEqual(rules(featurePullRequest({ files })), ['contract-test-changed']);
  });

  it('aceita a alteração quando o PR tem a label de aprovação explícita', () => {
    const files = [...featurePullRequest().files, existingContract];
    const labels = [LABELS.contractChangeApproved];
    assert.deepEqual(evaluatePullRequest(featurePullRequest({ files, labels })), []);
  });
});

describe('fluxo de desenvolvimento: main só recebe commits por PR', () => {
  it('aponta commit que não veio de PR com merge na main', () => {
    const commits = [
      { sha: 'aaa', pulls: [{ mergedAt: '2026-11-16T12:00:00Z', baseRef: 'main' }] },
      { sha: 'bbb', pulls: [] },
    ];
    assert.deepEqual(findCommitsWithoutMergedPullRequest({ commits, baseBranch: 'main' }), ['bbb']);
  });
});
