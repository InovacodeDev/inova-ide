import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LABELS,
  evaluatePullRequest,
  findCommitsWithoutMergedPullRequest,
  isProductionCode,
  parseBranch,
} from './policy.mjs';

function taskIssue(headRef, overrides = {}) {
  return {
    state: 'OPEN',
    labels: [LABELS.task],
    parent: { number: 10, labels: [LABELS.demand] },
    linkedBranches: [headRef],
    ...overrides,
  };
}

function pullRequest(headRef, overrides = {}) {
  return {
    headRef,
    isCrossRepository: false,
    labels: [],
    closingIssues: [12],
    issue: taskIssue(headRef),
    files: [],
    ...overrides,
  };
}

function rules(input) {
  return evaluatePullRequest(input).map((violation) => violation.rule);
}

describe('nomes de branch malformados', () => {
  const invalid = [
    'main',
    '12-file-viewer',
    'feat/12',
    'feat/12-',
    'feat/0-zero',
    'feat/012-leading-zero',
    'feat/12-File-Viewer',
    'feat/12-file_viewer',
    'feat/12-file--viewer',
    'feature/12-file-viewer',
    'feat/12-file-viewer/extra',
    ' feat/12-file-viewer',
    'feat/12-file-viewer\nrelease/v1.0.0',
    'release/1.2.3',
    'release/v1.2',
    'release/v1.2.3-beta',
    '',
  ];

  for (const name of invalid) {
    it(`rejeita ${JSON.stringify(name)}`, () => {
      assert.equal(parseBranch(name), null);
    });
  }

  it('não consulta a issue quando o nome é inválido', () => {
    assert.deepEqual(rules(pullRequest('wip', { issue: null, closingIssues: [] })), [
      'branch-name',
    ]);
  });
});

describe('vínculo com a issue', () => {
  it('rejeita PR que fecha outra issue, mas não a da branch', () => {
    assert.deepEqual(rules(pullRequest('refactor/12-split-files', { closingIssues: [13, 120] })), [
      'pr-does-not-close-issue',
    ]);
  });

  it('rejeita issue já fechada', () => {
    const headRef = 'refactor/12-split-files';
    const issue = taskIssue(headRef, { state: 'CLOSED' });
    assert.deepEqual(rules(pullRequest(headRef, { issue })), ['issue-closed']);
  });

  it('rejeita branch vinculada com nome parecido', () => {
    const headRef = 'refactor/12-split-files';
    const issue = taskIssue(headRef, { linkedBranches: ['refactor/12-split-files-2'] });
    assert.deepEqual(rules(pullRequest(headRef, { issue })), ['branch-not-linked']);
  });

  it('não exige branch vinculada em PR de fork', () => {
    const headRef = 'refactor/12-split-files';
    const issue = taskIssue(headRef, { linkedBranches: [] });
    assert.deepEqual(rules(pullRequest(headRef, { issue, isCrossRepository: true })), []);
  });

  it('rejeita a demanda usada direto como tarefa', () => {
    const headRef = 'refactor/10-whole-demand';
    const issue = taskIssue(headRef, { labels: [LABELS.demand], parent: null });
    assert.deepEqual(rules(pullRequest(headRef, { issue, closingIssues: [10] })), [
      'issue-not-task',
      'task-without-demand',
    ]);
  });

  it('relata todas as violações de uma vez', () => {
    const headRef = 'feat/12-file-viewer';
    const issue = { state: 'CLOSED', labels: [], parent: null, linkedBranches: [] };
    assert.deepEqual(rules(pullRequest(headRef, { issue, closingIssues: [] })), [
      'issue-closed',
      'issue-not-task',
      'task-without-demand',
      'branch-not-linked',
      'pr-does-not-close-issue',
      'missing-contract-test',
      'missing-edge-test',
    ]);
  });

  it('release não exige issue, mas não pode alterar código de produção', () => {
    const files = [
      { filename: 'package.json', status: 'modified' },
      { filename: 'CHANGELOG.md', status: 'modified' },
    ];
    const release = pullRequest('release/v1.2.3', { issue: null, closingIssues: [], files });
    assert.deepEqual(rules(release), []);
    const withCode = {
      ...release,
      files: [...files, { filename: 'src/cli.ts', status: 'modified' }],
    };
    assert.deepEqual(rules(withCode), ['production-code-in-non-code-branch']);
  });
});

describe('tentativas de burlar os testes obrigatórios', () => {
  const source = { filename: 'src/core/file-viewer.ts', status: 'added' };
  const newContract = { filename: 'src/core/file-viewer.contract.test.ts', status: 'added' };
  const newEdge = { filename: 'src/core/file-viewer.edge.test.ts', status: 'added' };

  it('teste comum não substitui contrato nem cenários de bug em feat', () => {
    const files = [source, { filename: 'src/core/file-viewer.test.ts', status: 'added' }];
    assert.deepEqual(rules(pullRequest('feat/12-file-viewer', { files })), [
      'missing-contract-test',
      'missing-edge-test',
    ]);
  });

  it('remover um teste de cenários de bug não conta como criar', () => {
    const files = [source, newContract, { ...newEdge, status: 'removed' }];
    assert.deepEqual(rules(pullRequest('feat/12-file-viewer', { files })), ['missing-edge-test']);
  });

  it('feat sem código de produção ainda exige os dois testes', () => {
    const files = [{ filename: 'apps/desktop/src/renderer/styles.css', status: 'modified' }];
    assert.deepEqual(rules(pullRequest('feat/12-file-viewer', { files })), [
      'missing-contract-test',
      'missing-edge-test',
    ]);
  });

  it('feat aceita cenários de bug em arquivo existente atualizado', () => {
    const files = [source, newContract, { ...newEdge, status: 'modified' }];
    assert.deepEqual(rules(pullRequest('feat/12-file-viewer', { files })), []);
  });

  it('refactor e perf não exigem teste novo', () => {
    const files = [{ filename: 'src/core/files.ts', status: 'modified' }];
    assert.deepEqual(rules(pullRequest('refactor/12-split-files', { files })), []);
    assert.deepEqual(rules(pullRequest('perf/12-faster-scan', { files })), []);
  });

  for (const type of ['docs', 'test', 'chore', 'ci', 'build']) {
    it(`${type} não pode esconder mudança de código de produção`, () => {
      const headRef = `${type}/12-sneaky`;
      const files = [{ filename: 'apps/desktop/src/main/index.ts', status: 'removed' }];
      assert.deepEqual(rules(pullRequest(headRef, { files })), [
        'production-code-in-non-code-branch',
      ]);
    });
  }

  it('chore pode alterar teste, config, workflow e documentação', () => {
    const files = [
      { filename: 'src/core/files.edge.test.ts', status: 'modified' },
      { filename: 'apps/desktop/test/helpers.ts', status: 'modified' },
      { filename: 'vitest.config.ts', status: 'modified' },
      { filename: 'eslint.config.js', status: 'modified' },
      { filename: '.github/workflows/ci.yml', status: 'modified' },
      { filename: 'src/core/fixtures/sample.ts', status: 'added' },
      { filename: 'src/types/global.d.ts', status: 'modified' },
      { filename: 'docs/dev-flow.md', status: 'modified' },
      { filename: 'pnpm-lock.yaml', status: 'modified' },
    ];
    assert.deepEqual(rules(pullRequest('chore/12-tooling', { files })), []);
  });
});

describe('classificação de código de produção', () => {
  const production = [
    'src/cli.ts',
    'apps/desktop/src/renderer/App.tsx',
    'scripts/deploy.mjs',
    'src/core/testing.ts',
    'src/core/contest/latest.ts',
  ];
  const notProduction = [
    'src/core/files.test.ts',
    'src/core/files.contract.test.ts',
    'scripts/deploy.test.mjs',
    'apps/desktop/test/selftest.test.ts',
    'apps/desktop/test/helpers.ts',
    'README.md',
    'package.json',
  ];

  for (const path of production) {
    it(`${path} é código de produção`, () => assert.equal(isProductionCode(path), true));
  }
  for (const path of notProduction) {
    it(`${path} não é código de produção`, () => assert.equal(isProductionCode(path), false));
  }
});

describe('tentativas de burlar a imutabilidade dos contratos', () => {
  const contract = 'src/core/files.contract.test.ts';
  const refactor = 'refactor/12-split-files';

  it('rejeita renomear um contrato para um nome comum', () => {
    const files = [
      { filename: 'src/core/files.test.ts', status: 'renamed', previous_filename: contract },
    ];
    assert.deepEqual(rules(pullRequest(refactor, { files })), ['contract-test-changed']);
  });

  it('rejeita mover um contrato de diretório', () => {
    const files = [
      {
        filename: 'src/files/files.contract.test.ts',
        status: 'renamed',
        previous_filename: contract,
      },
    ];
    assert.deepEqual(rules(pullRequest(refactor, { files })), ['contract-test-changed']);
  });

  it('rejeita o status "changed" em contrato existente', () => {
    const files = [{ filename: contract, status: 'changed' }];
    assert.deepEqual(rules(pullRequest(refactor, { files })), ['contract-test-changed']);
  });

  it('aceita promover um teste comum a contrato', () => {
    const files = [
      { filename: contract, status: 'renamed', previous_filename: 'src/core/files.test.ts' },
    ];
    assert.deepEqual(rules(pullRequest(refactor, { files })), []);
  });

  it('aceita copiar um contrato para um arquivo novo', () => {
    const files = [
      {
        filename: 'src/core/files-v2.contract.test.ts',
        status: 'copied',
        previous_filename: contract,
      },
    ];
    assert.deepEqual(rules(pullRequest(refactor, { files })), []);
  });

  it('a regra vale para contratos .mjs e do desktop', () => {
    const files = [
      { filename: 'scripts/dev-flow/policy.contract.test.mjs', status: 'modified' },
      { filename: 'apps/desktop/test/chat.contract.test.ts', status: 'removed' },
    ];
    const violations = evaluatePullRequest(pullRequest(refactor, { files }));
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /policy\.contract\.test\.mjs/);
    assert.match(violations[0].message, /chat\.contract\.test\.ts/);
  });

  it('label parecida não autoriza a alteração', () => {
    const files = [{ filename: contract, status: 'modified' }];
    const labels = ['contrato-alteracao', 'CONTRATO-ALTERACAO-APROVADA'];
    assert.deepEqual(rules(pullRequest(refactor, { files, labels })), ['contract-test-changed']);
  });

  it('release também não pode alterar contrato', () => {
    const files = [{ filename: contract, status: 'modified' }];
    const release = pullRequest('release/v1.2.3', { issue: null, closingIssues: [], files });
    assert.deepEqual(rules(release), ['contract-test-changed']);
  });
});

describe('push direto na main', () => {
  const merged = { mergedAt: '2026-11-16T12:00:00Z', baseRef: 'main' };

  it('aceita commits de PR com merge', () => {
    const commits = [
      { sha: 'aaa', pulls: [merged] },
      { sha: 'bbb', pulls: [{ mergedAt: null, baseRef: 'main' }, merged] },
    ];
    assert.deepEqual(findCommitsWithoutMergedPullRequest({ commits, baseBranch: 'main' }), []);
  });

  it('PR aberto não legitima o commit', () => {
    const commits = [{ sha: 'aaa', pulls: [{ mergedAt: null, baseRef: 'main' }] }];
    assert.deepEqual(findCommitsWithoutMergedPullRequest({ commits, baseBranch: 'main' }), ['aaa']);
  });

  it('PR com merge em outra branch não legitima o commit', () => {
    const commits = [{ sha: 'aaa', pulls: [{ ...merged, baseRef: 'develop' }] }];
    assert.deepEqual(findCommitsWithoutMergedPullRequest({ commits, baseBranch: 'main' }), ['aaa']);
  });

  it('push vazio não gera violação', () => {
    assert.deepEqual(findCommitsWithoutMergedPullRequest({ commits: [], baseBranch: 'main' }), []);
  });
});
