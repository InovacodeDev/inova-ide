import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importSkillFolder, installSkillFromText, SkillValidationError } from './skills.js';

const SKILL_MD = '---\nname: sk\ndescription: Skill\n---\n\nBody\n';

let root: string;
let scratch: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-review3-skill-root-'));
  scratch = await mkdtemp(join(tmpdir(), 'inova-review3-skill-src-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

async function sourceWith(files: Record<string, string>): Promise<string> {
  const dir = join(scratch, 'src');
  for (const [relative, content] of Object.entries({ 'SKILL.md': SKILL_MD, ...files })) {
    await mkdir(dirname(join(dir, relative)), { recursive: true });
    await writeFile(join(dir, relative), content);
  }
  return dir;
}

describe('importSkillFolder accepts ordinary code and prose', () => {
  it.each([
    ['python reading an environment variable', 'run.py', 'api_key = os.environ["X"]\n'],
    [
      'javascript reading an environment variable',
      'run.js',
      'const token = process.env.GH_TOKEN\n',
    ],
    ['sorted with a key function', 'sort.py', 'sorted(x, key=lambda i: i)\n'],
    ['token assigned from a tokenizer', 'tok.py', 'token = tokenizer.encode(t)\n'],
    ['bearer header from an f-string', 'http.py', 'h = f"Bearer {token}"\n'],
    ['camelCase key variable', 'cache.ts', 'const cacheKey = build(a)\n'],
  ])('%s', async (_name, file, content) => {
    const dir = await sourceWith({ [file]: content });
    await expect(importSkillFolder({ root, id: 'sk', sourceDir: dir })).resolves.toHaveProperty(
      'hash',
    );
  });

  it('still rejects a real token shape in a script', async () => {
    const dir = await sourceWith({ 'run.py': `api_key = "ghp_${'a1B2'.repeat(9)}"\n` });
    await expect(importSkillFolder({ root, id: 'sk', sourceDir: dir })).rejects.toBeInstanceOf(
      SkillValidationError,
    );
  });
});

describe('installSkillFromText accepts example code in the body', () => {
  it('keeps a body that shows an environment variable assignment', async () => {
    const content = `${SKILL_MD}\n\`\`\`py\napi_key = os.environ["X"]\n\`\`\`\n`;
    await expect(installSkillFromText({ root, id: 'sk', content })).resolves.toHaveProperty('hash');
  });
});
