#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELATIVE_PACKAGE_PATHS, bumpVersions, checkVersions, nextVersion } from './version.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_TARGETS = new Set(['major', 'minor', 'patch']);

export function parseReleaseTarget(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const target = args[0];
  if (args.length !== 1 || !target || !RELEASE_TARGETS.has(target)) {
    throw new Error('Usage: node scripts/deploy.mjs <major|minor|patch>');
  }
  return target;
}

function defaultGitRunner(args, repoRoot) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    const detail = stderr.trim();
    throw new Error(
      detail ? `git ${args.join(' ')} failed: ${detail}` : `git ${args.join(' ')} failed`,
      {
        cause: error,
      },
    );
  }
}

function assertCleanWorktree(runGit, repoRoot) {
  const status = runGit(['status', '--porcelain'], repoRoot);
  if (status.trim().length > 0) {
    throw new Error(`Worktree has uncommitted changes:\n${status.trimEnd()}`);
  }
}

function getCurrentBranch(runGit, repoRoot) {
  try {
    const branch = runGit(['symbolic-ref', '--short', 'HEAD'], repoRoot).trim();
    if (branch) return branch;
  } catch {
    throw new Error('HEAD is detached. Checkout a branch before deploying.');
  }
  throw new Error('HEAD is detached. Checkout a branch before deploying.');
}

function assertTagAvailable({ tag, repoRoot, runGit }) {
  const localRef = runGit(['for-each-ref', `refs/tags/${tag}`], repoRoot).trim();
  if (localRef.length > 0) {
    throw new Error(`Tag ${tag} already exists locally.`);
  }
  const remoteRef = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], repoRoot).trim();
  if (remoteRef.length > 0) {
    throw new Error(`Tag ${tag} already exists on origin.`);
  }
}

export function deploy({
  target,
  repoRoot = defaultRoot,
  runGit = defaultGitRunner,
  log = console.log,
}) {
  const releaseTarget = parseReleaseTarget([target]);
  assertCleanWorktree(runGit, repoRoot);
  const branch = getCurrentBranch(runGit, repoRoot);
  const current = checkVersions({ repoRoot });
  const next = nextVersion(current, releaseTarget);
  const tag = `v${next}`;

  assertTagAvailable({ tag, repoRoot, runGit });

  const { updated } = bumpVersions({ target: releaseTarget, repoRoot });
  checkVersions({ repoRoot, tag });
  log(`Bumped version: ${current} -> ${updated}`);

  runGit(['add', ...RELATIVE_PACKAGE_PATHS], repoRoot);
  runGit(['commit', '-m', `chore: release ${tag}`], repoRoot);
  log(`Committed release ${tag} on ${branch}`);

  runGit(['tag', '-a', tag, '-m', tag], repoRoot);
  log(`Created tag ${tag}`);

  runGit(['push', 'origin', branch], repoRoot);
  runGit(['push', 'origin', `refs/tags/${tag}`], repoRoot);
  log(`Pushed ${branch} and tag ${tag} to origin`);

  return { current, updated, tag, branch };
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  try {
    const target = parseReleaseTarget(process.argv.slice(2));
    deploy({ target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
