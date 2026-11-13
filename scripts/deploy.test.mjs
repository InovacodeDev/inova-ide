import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { deploy, parseReleaseTarget, releaseChangelog } from './deploy.mjs';

const tempDirs = [];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setupRepo(version = '0.3.0') {
  const base = mkdtempSync(join(tmpdir(), 'inova-deploy-test-'));
  tempDirs.push(base);

  const originDir = join(base, 'origin.git');
  const workDir = join(base, 'work');
  mkdirSync(originDir, { recursive: true });
  mkdirSync(join(workDir, 'apps/desktop'), { recursive: true });

  git(['init', '--bare', '--initial-branch=main', originDir], base);
  git(['init', '--initial-branch=main', workDir], base);
  git(['config', 'user.name', 'Test User'], workDir);
  git(['config', 'user.email', 'test@example.com'], workDir);
  git(['remote', 'add', 'origin', originDir], workDir);

  writeFileSync(
    join(workDir, 'package.json'),
    `${JSON.stringify({ name: 'root', version }, null, 2)}\n`,
  );
  writeFileSync(
    join(workDir, 'apps/desktop/package.json'),
    `${JSON.stringify({ name: 'desktop', version }, null, 2)}\n`,
  );

  git(['add', '.'], workDir);
  git(['commit', '-m', 'init'], workDir);
  git(['push', '-u', 'origin', 'main'], workDir);

  return { originDir, workDir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseReleaseTarget', () => {
  it('accepts major, minor, and patch with or without leading --', () => {
    assert.equal(parseReleaseTarget(['major']), 'major');
    assert.equal(parseReleaseTarget(['minor']), 'minor');
    assert.equal(parseReleaseTarget(['patch']), 'patch');
    assert.equal(parseReleaseTarget(['--', 'minor']), 'minor');
  });

  it('rejects missing, extra, or non-bump arguments', () => {
    assert.throws(() => parseReleaseTarget([]), /Usage:/);
    assert.throws(() => parseReleaseTarget(['0.4.0']), /Usage:/);
    assert.throws(() => parseReleaseTarget(['patch', 'extra']), /Usage:/);
  });
});

describe('releaseChangelog', () => {
  it('renames the unreleased section and opens an empty one above it', () => {
    const content = '# Changelog\n\n## [Não lançado]\n\n- Novo.\n';
    assert.equal(
      releaseChangelog({ content, version: '1.2.0', date: '2026-11-13' }),
      '# Changelog\n\n## [Não lançado]\n\n## [1.2.0] - 2026-11-13\n\n- Novo.\n',
    );
  });

  it('returns null when there is no unreleased section', () => {
    assert.equal(
      releaseChangelog({ content: '# Changelog\n', version: '1.2.0', date: '2026-11-13' }),
      null,
    );
  });
});

describe('deploy', () => {
  it('fails when tracked files are modified and leaves repo untouched', () => {
    const { workDir } = setupRepo('0.3.0');
    writeFileSync(join(workDir, 'README.md'), 'dirty\n');

    assert.throws(
      () => deploy({ target: 'patch', repoRoot: workDir, log: () => {} }),
      /Worktree has uncommitted changes/,
    );

    const pkg = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '0.3.0');
    assert.equal(git(['tag'], workDir), '');
  });

  it('fails on detached HEAD', () => {
    const { workDir } = setupRepo('0.3.0');
    const sha = git(['rev-parse', 'HEAD'], workDir);
    git(['checkout', '--detach', sha], workDir);

    assert.throws(
      () => deploy({ target: 'patch', repoRoot: workDir, log: () => {} }),
      /HEAD is detached/,
    );
  });

  it('fails when target tag already exists on origin without bumping', () => {
    const { workDir } = setupRepo('0.3.0');
    git(['tag', '-a', 'v0.3.1', '-m', 'existing'], workDir);
    git(['push', 'origin', 'refs/tags/v0.3.1'], workDir);
    git(['tag', '-d', 'v0.3.1'], workDir);

    assert.throws(
      () => deploy({ target: 'patch', repoRoot: workDir, log: () => {} }),
      /Tag v0.3.1 already exists on origin/,
    );

    const pkg = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '0.3.0');
  });

  it('bumps, commits, tags, and pushes branch before tag in order', () => {
    const { originDir, workDir } = setupRepo('0.3.0');
    const gitCalls = [];
    const trackingGit = (args, cwd) => {
      gitCalls.push(args);
      return execFileSync('git', args, { cwd, encoding: 'utf8' });
    };

    const result = deploy({
      target: 'minor',
      repoRoot: workDir,
      runGit: trackingGit,
      log: () => {},
    });

    assert.deepEqual(result, {
      current: '0.3.0',
      updated: '0.4.0',
      tag: 'v0.4.0',
      branch: 'main',
    });

    const pushBranchIdx = gitCalls.findIndex((a) => a[0] === 'push' && a[2] === 'main');
    const pushTagIdx = gitCalls.findIndex((a) => a[0] === 'push' && a[2] === 'refs/tags/v0.4.0');
    const commitIdx = gitCalls.findIndex((a) => a[0] === 'commit');
    const tagIdx = gitCalls.findIndex((a) => a[0] === 'tag');

    assert.ok(commitIdx !== -1 && tagIdx !== -1);
    assert.ok(commitIdx < tagIdx);
    assert.ok(tagIdx < pushBranchIdx);
    assert.ok(pushBranchIdx < pushTagIdx);

    const tagCommit = git(['rev-list', '-n', '1', 'v0.4.0'], originDir);
    const mainCommit = git(['rev-parse', 'refs/heads/main'], originDir);
    assert.equal(tagCommit, mainCommit);

    const taggedRootPkg = JSON.parse(git(['show', 'v0.4.0:package.json'], originDir));
    const taggedDesktopPkg = JSON.parse(
      git(['show', 'v0.4.0:apps/desktop/package.json'], originDir),
    );
    assert.equal(taggedRootPkg.version, '0.4.0');
    assert.equal(taggedDesktopPkg.version, '0.4.0');
  });

  it('promotes the unreleased changelog section into the tagged release', () => {
    const { originDir, workDir } = setupRepo('0.3.0');
    writeFileSync(
      join(workDir, 'CHANGELOG.md'),
      '# Changelog\n\n## [Não lançado]\n\n- Novo.\n\n## [0.3.0] - 2026-01-01\n\n- Antigo.\n',
    );
    git(['add', 'CHANGELOG.md'], workDir);
    git(['commit', '-m', 'changelog'], workDir);

    deploy({ target: 'patch', repoRoot: workDir, log: () => {}, today: () => '2026-11-13' });

    assert.equal(
      git(['show', 'v0.3.1:CHANGELOG.md'], originDir),
      '# Changelog\n\n## [Não lançado]\n\n## [0.3.1] - 2026-11-13\n\n- Novo.\n\n## [0.3.0] - 2026-01-01\n\n- Antigo.',
    );
  });

  it('fails cleanly via CLI on invalid arguments', () => {
    let failed = false;
    try {
      execFileSync(process.execPath, ['scripts/deploy.mjs', 'invalid'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failed = true;
      assert.equal(error.status, 1);
      assert.match(String(error.stderr), /Usage:/);
    }
    assert.equal(failed, true);
  });
});
