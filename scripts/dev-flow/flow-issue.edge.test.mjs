import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePullRequest, mentionsIssueKey, parseBranch } from './policy.mjs';

function rules(input) {
  return evaluatePullRequest({
    isCrossRepository: false,
    labels: [],
    closingIssues: [],
    issue: null,
    files: [],
    ...input,
  }).map((violation) => violation.rule);
}

describe('branch do InovaFlow malformada', () => {
  const invalid = [
    'feat/ide-41-atalhos',
    'feat/IDE-0-atalhos',
    'feat/IDE-041-atalhos',
    'feat/IDE-41',
    'feat/IDE-41-',
    'feat/IDE41-atalhos',
    'feat/-41-atalhos',
    'feat/1DE-41-atalhos',
    'feat/IDE-41-Atalhos',
    'feature/IDE-41-atalhos',
    'feat/IDE-41-atalhos/extra',
  ];

  for (const name of invalid) {
    it(`rejeita ${JSON.stringify(name)}`, () => {
      assert.equal(parseBranch(name), null);
    });
  }

  it('aceita chave com dígito depois da primeira letra', () => {
    assert.deepEqual(parseBranch('fix/K8S-7-pod'), {
      kind: 'flow',
      type: 'fix',
      issueKey: 'K8S-7',
    });
  });
});

describe('citação da chave no PR', () => {
  it('não aceita chave com número maior que começa igual', () => {
    assert.equal(mentionsIssueKey({ text: 'IDE-410', issueKey: 'IDE-41' }), false);
  });

  it('não aceita chave de outro projeto que termina igual', () => {
    assert.equal(mentionsIssueKey({ text: 'XIDE-41', issueKey: 'IDE-41' }), false);
  });

  it('não aceita chave em minúsculas', () => {
    assert.equal(mentionsIssueKey({ text: 'ide-41', issueKey: 'IDE-41' }), false);
  });

  it('aceita chave entre parênteses, colchetes ou no fim do texto', () => {
    for (const text of ['(IDE-41)', '[IDE-41] título', 'fecha IDE-41', 'IDE-41: título']) {
      assert.equal(mentionsIssueKey({ text, issueKey: 'IDE-41' }), true, text);
    }
  });

  it('rejeita PR sem título e sem descrição', () => {
    assert.deepEqual(rules({ headRef: 'chore/IDE-41-limpeza' }), ['pr-missing-flow-issue']);
  });

  it('rejeita PR que cita outra chave', () => {
    assert.deepEqual(rules({ headRef: 'chore/IDE-41-limpeza', title: 'chore: IDE-42' }), [
      'pr-missing-flow-issue',
    ]);
  });

  it('não consulta issue do GitHub na branch do InovaFlow', () => {
    assert.deepEqual(rules({ headRef: 'docs/IDE-41-guia', title: 'docs: guia IDE-41' }), []);
  });

  it('branch docs do InovaFlow não pode alterar código de produção', () => {
    const files = [{ filename: 'src/core/files.ts', status: 'modified' }];
    assert.deepEqual(rules({ headRef: 'docs/IDE-41-guia', title: 'IDE-41', files }), [
      'production-code-in-non-code-branch',
    ]);
  });
});
