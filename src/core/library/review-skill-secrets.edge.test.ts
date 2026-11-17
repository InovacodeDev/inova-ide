import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importSkillFolder, installSkillFromText, SkillValidationError } from './skills.js';
import { skillDir } from './store.js';

const GITHUB = `ghp_${'a1B2'.repeat(9)}`;
const SKILL_MD = '---\nname: sk\ndescription: Skill\n---\n\nBody\n';

let root: string;
let scratch: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-review-skill-root-'));
  scratch = await mkdtemp(join(tmpdir(), 'inova-review-skill-src-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

async function sourceWith(files: Record<string, string | Buffer>): Promise<string> {
  const dir = join(scratch, 'src');
  for (const [relative, content] of Object.entries({ 'SKILL.md': SKILL_MD, ...files })) {
    await mkdir(dirname(join(dir, relative)), { recursive: true });
    await writeFile(join(dir, relative), content);
  }
  return dir;
}

async function importError(sourceDir: string): Promise<Error> {
  try {
    await importSkillFolder({ root, id: 'sk', sourceDir });
  } catch (error: unknown) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected the import to be rejected');
}

describe('importSkillFolder scans every text file for secrets', () => {
  it('rejects the whole import and names the relative path, never the content', async () => {
    const dir = await sourceWith({ 'docs/config.json': JSON.stringify({ apiKey: GITHUB }) });
    const error = await importError(dir);
    expect(error).toBeInstanceOf(SkillValidationError);
    expect(error.message).toContain('docs/config.json');
    expect(error.message).not.toContain(GITHUB);
    await expect(readdir(skillDir(root, 'sk'))).rejects.toThrow();
  });

  it('detects a secret assignment in a script', async () => {
    const dir = await sourceWith({ 'run.sh': 'export GITHUB_TOKEN=hunter2value\n' });
    expect((await importError(dir)).message).toContain('run.sh');
  });

  it('skips binary files that contain a NUL byte', async () => {
    const binary = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(GITHUB)]);
    const dir = await sourceWith({ 'asset.bin': binary });
    await expect(importSkillFolder({ root, id: 'sk', sourceDir: dir })).resolves.toHaveProperty(
      'hash',
    );
  });

  it('skips text files above 1 MiB', async () => {
    const dir = await sourceWith({ 'big.txt': `${GITHUB}\n${'x'.repeat(1024 * 1024)}` });
    await expect(importSkillFolder({ root, id: 'sk', sourceDir: dir })).resolves.toHaveProperty(
      'hash',
    );
  });

  it('imports a folder with clean extra files and variable references', async () => {
    const dir = await sourceWith({
      'run.sh': 'export GITHUB_TOKEN=${GITHUB_TOKEN}\nOUT=./out\n',
      'notes.md': 'Use the token flag.\n',
    });
    await expect(importSkillFolder({ root, id: 'sk', sourceDir: dir })).resolves.toHaveProperty(
      'hash',
    );
  });

  it('still rejects an environment file without reading it', async () => {
    const dir = await sourceWith({ '.env.local': `TOKEN=${GITHUB}` });
    const error = await importError(dir);
    expect(error.message).toContain('.env.local');
    expect(error.message).not.toContain(GITHUB);
  });
});

describe('installSkillFromText', () => {
  it('rejects a non-sk token and an assignment in the body', async () => {
    for (const body of [`Use ${GITHUB}`, 'API_KEY=hunter2value']) {
      await expect(
        installSkillFromText({
          root,
          id: 'sk',
          content: `---\nname: sk\ndescription: Skill\n---\n\n${body}\n`,
        }),
      ).rejects.toBeInstanceOf(SkillValidationError);
    }
  });
});
