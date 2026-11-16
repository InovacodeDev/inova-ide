#!/usr/bin/env node
import { ghGraphql, ghJson, requireEnv, requireRepository } from './gh.mjs';
import { evaluatePullRequest, parseBranch } from './policy.mjs';

const PULL_REQUEST_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefName
      isCrossRepository
      labels(first: 100) { nodes { name } }
      closingIssuesReferences(first: 50) { nodes { number } }
    }
  }
}`;

const ISSUE_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      state
      labels(first: 100) { nodes { name } }
      parent { number labels(first: 100) { nodes { name } } }
      linkedBranches(first: 100) { nodes { ref { name } } }
    }
  }
}`;

function labelNames(connection) {
  return connection.nodes.map((label) => label.name);
}

function requirePullRequestNumber() {
  const raw = requireEnv('PR_NUMBER');
  if (!/^[1-9]\d*$/.test(raw))
    throw new Error(`PR_NUMBER must be a positive integer, got "${raw}"`);
  return Number(raw);
}

function fetchPullRequest({ owner, repo, number }) {
  const { data, errors } = ghGraphql(PULL_REQUEST_QUERY, { owner, repo, number });
  const pullRequest = data?.repository?.pullRequest;
  if (errors.length > 0 || !pullRequest) {
    throw new Error(`Could not load pull request #${number}: ${JSON.stringify(errors)}`);
  }
  return {
    headRef: pullRequest.headRefName,
    isCrossRepository: pullRequest.isCrossRepository,
    labels: labelNames(pullRequest.labels),
    closingIssues: pullRequest.closingIssuesReferences.nodes.map((issue) => issue.number),
  };
}

function fetchIssue({ owner, repo, number }) {
  const { data, errors } = ghGraphql(ISSUE_QUERY, { owner, repo, number });
  if (errors.length > 0 && errors.every((error) => error.type === 'NOT_FOUND')) return null;
  const issue = data?.repository?.issue;
  if (errors.length > 0 || !issue) {
    throw new Error(`Could not load issue #${number}: ${JSON.stringify(errors)}`);
  }
  return {
    state: issue.state,
    labels: labelNames(issue.labels),
    parent: issue.parent
      ? { number: issue.parent.number, labels: labelNames(issue.parent.labels) }
      : null,
    linkedBranches: issue.linkedBranches.nodes.flatMap((node) => (node.ref ? [node.ref.name] : [])),
  };
}

function fetchFiles({ owner, repo, number }) {
  return ghJson([
    'api',
    '--paginate',
    '--slurp',
    `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  ]).flat();
}

function escapeWorkflowCommandData(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function main() {
  const { owner, repo } = requireRepository();
  const number = requirePullRequestNumber();
  const pullRequest = fetchPullRequest({ owner, repo, number });
  const branch = parseBranch(pullRequest.headRef);
  const issue =
    branch?.kind === 'task' ? fetchIssue({ owner, repo, number: branch.issueNumber }) : null;
  const violations = evaluatePullRequest({
    ...pullRequest,
    files: fetchFiles({ owner, repo, number }),
    issue,
  });
  if (violations.length === 0) {
    console.log(`PR #${number} segue o fluxo de desenvolvimento.`);
    return;
  }
  for (const { rule, message } of violations) {
    console.error(`::error title=${rule}::${escapeWorkflowCommandData(message)}`);
  }
  process.exitCode = 1;
}

main();
