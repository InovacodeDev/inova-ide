import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { expandCommandPrompt, listProjectCommands } from './commands.js';

const tmpDirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-commands-')));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('listProjectCommands discovers claude, codex, and gemini commands and skills', async () => {
  const root = await tmpDir();
  await mkdir(join(root, '.claude', 'commands', 'db'), { recursive: true });
  await mkdir(join(root, '.claude', 'skills', 'reviewer'), { recursive: true });
  await mkdir(join(root, '.agents', 'skills', 'planner'), { recursive: true });
  await mkdir(join(root, '.gemini', 'skills', 'auditor'), { recursive: true });
  await mkdir(join(root, '.gemini', 'commands', 'ops'), { recursive: true });

  await writeFile(
    join(root, '.claude', 'commands', 'deploy.md'),
    '---\ndescription: Deploy service\n---\nRun deploy for $ARGUMENTS.',
  );
  await writeFile(
    join(root, '.claude', 'commands', 'db', 'migrate.md'),
    '# Run DB migrations\nApply pending SQL files.',
  );
  await writeFile(
    join(root, '.claude', 'skills', 'reviewer', 'SKILL.md'),
    '---\nname: code-reviewer\ndescription: Review diffs strictly\n---\nInspect changes carefully.',
  );
  await writeFile(
    join(root, '.agents', 'skills', 'planner', 'SKILL.md'),
    '---\ndescription: Create execution plan\n---\nWrite steps before coding.',
  );
  await writeFile(
    join(root, '.gemini', 'skills', 'auditor', 'SKILL.md'),
    '---\nname: sec-audit\ndescription: Audit dependencies\n---\nCheck packages.',
  );
  await writeFile(
    join(root, '.gemini', 'commands', 'ops', 'status.toml'),
    'description = "Check cluster status"\nprompt = """\nInspect pods in $ARGUMENTS\n"""\n',
  );

  const commands = await listProjectCommands(root);

  expect(commands).toEqual([
    {
      name: 'code-reviewer',
      description: 'Review diffs strictly',
      source: 'claude',
      kind: 'skill',
      body: 'Inspect changes carefully.',
    },
    {
      name: 'db:migrate',
      description: 'Run DB migrations',
      source: 'claude',
      kind: 'command',
      body: '# Run DB migrations\nApply pending SQL files.',
    },
    {
      name: 'deploy',
      description: 'Deploy service',
      source: 'claude',
      kind: 'command',
      body: 'Run deploy for $ARGUMENTS.',
    },
    {
      name: 'ops:status',
      description: 'Check cluster status',
      source: 'gemini',
      kind: 'command',
      body: 'Inspect pods in $ARGUMENTS',
    },
    {
      name: 'planner',
      description: 'Create execution plan',
      source: 'codex',
      kind: 'skill',
      body: 'Write steps before coding.',
    },
    {
      name: 'sec-audit',
      description: 'Audit dependencies',
      source: 'gemini',
      kind: 'skill',
      body: 'Check packages.',
    },
  ]);
});

test('listProjectCommands ignores malformed TOML and symlinks escaping project root', async () => {
  const root = await tmpDir();
  const outside = await tmpDir();
  await writeFile(join(outside, 'secret.md'), 'secret instructions');

  await mkdir(join(root, '.claude', 'commands'), { recursive: true });
  await mkdir(join(root, '.gemini', 'commands'), { recursive: true });
  await symlink(join(outside, 'secret.md'), join(root, '.claude', 'commands', 'leak.md'));
  await writeFile(join(root, '.gemini', 'commands', 'broken.toml'), 'description = "no prompt"');
  await writeFile(join(root, '.claude', 'commands', 'ok.md'), 'Valid command body');

  const commands = await listProjectCommands(root);

  expect(commands).toEqual([
    {
      name: 'ok',
      description: 'Valid command body',
      source: 'claude',
      kind: 'command',
      body: 'Valid command body',
    },
  ]);
});

test('expandCommandPrompt replaces $ARGUMENTS or appends trailing arguments', () => {
  expect(expandCommandPrompt('Deploy $ARGUMENTS to $ARGUMENTS', ' staging ')).toBe(
    'Deploy staging to staging',
  );
  expect(expandCommandPrompt('Review changes\n', 'src/main.ts')).toBe(
    'Review changes\n\nsrc/main.ts',
  );
  expect(expandCommandPrompt('  Simple prompt  \n', '   ')).toBe('Simple prompt');
});
