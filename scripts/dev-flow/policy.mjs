export const LABELS = {
  demand: 'demanda',
  task: 'tarefa',
  contractChangeApproved: 'contrato-alteracao-aprovada',
};

const TASK_BRANCH =
  /^(feat|fix|refactor|perf|docs|test|chore|ci|build)\/([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELEASE_BRANCH = /^release\/v\d+\.\d+\.\d+$/;
const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.[a-z]+$/;
const CONTRACT_TEST_FILE = /\.contract\.test\.[a-z]+$/;
const EDGE_TEST_FILE = /\.edge\.test\.[a-z]+$/;
const NON_PRODUCTION_PATH =
  /(?:^|\/)(?:test|tests|fixtures|__mocks__)\/|\.config\.[a-z]+$|\.d\.ts$|^\.github\//;
const TYPES_WITHOUT_PRODUCTION_CODE = new Set(['docs', 'test', 'chore', 'ci', 'build', 'release']);
const STATUSES_OF_NEW_FILE = new Set(['added', 'copied']);
const STATUSES_WITHOUT_CONTENT = new Set(['removed', 'unchanged']);

export function parseBranch(headRef) {
  if (RELEASE_BRANCH.test(headRef)) return { kind: 'release', type: 'release' };
  const match = TASK_BRANCH.exec(headRef);
  if (!match) return null;
  return { kind: 'task', type: match[1], issueNumber: Number(match[2]) };
}

export function isProductionCode(path) {
  return CODE_FILE.test(path) && !TEST_FILE.test(path) && !NON_PRODUCTION_PATH.test(path);
}

function violation(rule, message) {
  return { rule, message };
}

function pathOnBase(file) {
  return file.status === 'renamed' ? file.previous_filename : file.filename;
}

function isExistingContractChange(file) {
  if (STATUSES_OF_NEW_FILE.has(file.status) || file.status === 'unchanged') return false;
  return CONTRACT_TEST_FILE.test(pathOnBase(file) ?? '');
}

function checkIssueLink({ branch, headRef, isCrossRepository, closingIssues, issue }) {
  const number = branch.issueNumber;
  if (!issue) {
    return [
      violation('issue-not-found', `A branch aponta para a issue #${number}, que não existe.`),
    ];
  }
  const violations = [];
  if (issue.state !== 'OPEN') {
    violations.push(violation('issue-closed', `A issue #${number} está fechada.`));
  }
  if (!issue.labels.includes(LABELS.task)) {
    violations.push(
      violation('issue-not-task', `A issue #${number} não tem a label "${LABELS.task}".`),
    );
  }
  if (!issue.parent) {
    violations.push(
      violation('task-without-demand', `A issue #${number} não é sub-issue de uma demanda.`),
    );
  } else if (!issue.parent.labels.includes(LABELS.demand)) {
    violations.push(
      violation(
        'parent-not-demand',
        `A issue pai #${issue.parent.number} não tem a label "${LABELS.demand}".`,
      ),
    );
  }
  if (!isCrossRepository && !issue.linkedBranches.includes(headRef)) {
    violations.push(
      violation(
        'branch-not-linked',
        `A branch "${headRef}" não está vinculada à issue #${number}. Crie a branch com "gh issue develop".`,
      ),
    );
  }
  if (!closingIssues.includes(number)) {
    violations.push(
      violation(
        'pr-does-not-close-issue',
        `O PR não fecha a issue #${number}. Adicione "Closes #${number}" na descrição.`,
      ),
    );
  }
  return violations;
}

function checkContractImmutability(files, labels) {
  const changed = files.filter(isExistingContractChange).map(pathOnBase);
  if (changed.length === 0 || labels.includes(LABELS.contractChangeApproved)) return [];
  return [
    violation(
      'contract-test-changed',
      `Testes de contrato são imutáveis. Arquivos alterados: ${changed.join(', ')}. A alteração exige a label "${LABELS.contractChangeApproved}".`,
    ),
  ];
}

function checkRequiredTests(type, files) {
  const violations = [];
  const production = files.map((file) => file.filename).filter(isProductionCode);
  if (TYPES_WITHOUT_PRODUCTION_CODE.has(type) && production.length > 0) {
    violations.push(
      violation(
        'production-code-in-non-code-branch',
        `Branch do tipo "${type}" não pode alterar código de produção: ${production.join(', ')}. Use feat, fix, refactor ou perf.`,
      ),
    );
  }
  const addsContractTest = files.some(
    (file) => file.status === 'added' && CONTRACT_TEST_FILE.test(file.filename),
  );
  const touchesEdgeTest = files.some(
    (file) => !STATUSES_WITHOUT_CONTENT.has(file.status) && EDGE_TEST_FILE.test(file.filename),
  );
  if (type === 'feat' && !addsContractTest) {
    violations.push(
      violation(
        'missing-contract-test',
        'Branch "feat" exige um arquivo novo *.contract.test.* com a regra de negócio.',
      ),
    );
  }
  if ((type === 'feat' || type === 'fix') && !touchesEdgeTest) {
    violations.push(
      violation(
        'missing-edge-test',
        `Branch "${type}" exige um arquivo *.edge.test.* novo ou atualizado com os cenários de bug.`,
      ),
    );
  }
  return violations;
}

export function evaluatePullRequest({
  headRef,
  isCrossRepository,
  labels,
  closingIssues,
  files,
  issue,
}) {
  const branch = parseBranch(headRef);
  if (!branch) {
    return [
      violation(
        'branch-name',
        `Nome de branch inválido: "${headRef}". Use <tipo>/<numero-da-issue>-<slug> ou release/vX.Y.Z.`,
      ),
    ];
  }
  const issueViolations =
    branch.kind === 'task'
      ? checkIssueLink({ branch, headRef, isCrossRepository, closingIssues, issue })
      : [];
  return [
    ...issueViolations,
    ...checkContractImmutability(files, labels),
    ...checkRequiredTests(branch.type, files),
  ];
}

export function findCommitsWithoutMergedPullRequest({ commits, baseBranch }) {
  return commits
    .filter(
      (commit) =>
        !commit.pulls.some((pull) => pull.mergedAt !== null && pull.baseRef === baseBranch),
    )
    .map((commit) => commit.sha);
}
