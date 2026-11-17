#!/usr/bin/env node
import { ghJson, requireEnv, requireRepository } from './gh.mjs';
import { findCommitsWithoutMergedPullRequest } from './policy.mjs';

const SHA = /^[0-9a-f]{40}$/;
const NEW_BRANCH_SHA = '0'.repeat(40);

function requireSha(name) {
  const value = requireEnv(name);
  if (!SHA.test(value)) throw new Error(`${name} must be a full commit SHA, got "${value}"`);
  return value;
}

function fetchPushedShas({ owner, repo, before, after }) {
  if (before === NEW_BRANCH_SHA) return [after];
  const comparison = ghJson(['api', `repos/${owner}/${repo}/compare/${before}...${after}`]);
  return comparison.commits.map((commit) => commit.sha);
}

function fetchPulls({ owner, repo, sha }) {
  return ghJson(['api', `repos/${owner}/${repo}/commits/${sha}/pulls`]).map((pull) => ({
    mergedAt: pull.merged_at,
    baseRef: pull.base.ref,
  }));
}

function main() {
  const { owner, repo } = requireRepository();
  const baseBranch = requireEnv('BASE_BRANCH');
  const shas = fetchPushedShas({
    owner,
    repo,
    before: requireSha('BEFORE_SHA'),
    after: requireSha('AFTER_SHA'),
  });
  const commits = shas.map((sha) => ({ sha, pulls: fetchPulls({ owner, repo, sha }) }));
  const direct = findCommitsWithoutMergedPullRequest({ commits, baseBranch });
  if (direct.length === 0) {
    console.log(`Todos os ${shas.length} commits chegaram em ${baseBranch} por PR.`);
    return;
  }
  for (const sha of direct) {
    console.error(
      `::error title=direct-push::Commit ${sha} entrou em ${baseBranch} sem PR com merge.`,
    );
  }
  process.exitCode = 1;
}

main();
