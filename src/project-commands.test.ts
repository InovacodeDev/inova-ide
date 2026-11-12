import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from './main.js';
import { makeHarness, useTmpRoot } from './test-harness.js';

describe('inova project and run commands', () => {
  const tmp = useTmpRoot();

  it('project bind and list show path and label', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    h.out.length = 0;
    expect(await tmp.run(h, ['project', 'bind', 'pessoal'])).toBe(0);
    expect(await tmp.run(h, ['project', 'list'])).toBe(0);
    expect(h.out).toEqual([`${tmp.root()}  pessoal`]);
    expect(await tmp.run(h, ['project', 'unbind'])).toBe(0);
    h.out.length = 0;
    await tmp.run(h, ['project', 'list']);
    expect(h.out).toEqual([]);
  });

  it('run outside bound project exits 2 with bind hint', async () => {
    const h = makeHarness();
    expect(await tmp.run(h, ['run'])).toBe(2);
    expect(h.err).toEqual([
      `Nenhum projeto vinculado a ${tmp.root()}. Rode: inova project bind <label>`,
    ]);
  });

  it('run exits 127 with install hint when binary missing', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    await tmp.run(h, ['project', 'bind', 'pessoal']);
    h.spawnResult.value = 'not-found';
    expect(await tmp.run(h, ['run'])).toBe(127);
    expect(h.err).toEqual([
      'claude não encontrado. Instale: pnpm add -g @anthropic-ai/claude-code',
    ]);
  });

  it('run passes args after -- and exit code from child', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    await tmp.run(h, ['project', 'bind', 'pessoal']);
    h.spawnResult.value = 3;
    expect(await tmp.run(h, ['run', '--', '--resume'])).toBe(3);
    expect(h.spawned[0]?.args).toEqual(['--resume']);
    expect(h.spawned[0]?.cwd).toBe(tmp.root());
  });

  it('project bind resolves a relative path against the working directory', async () => {
    const h = makeHarness();
    await mkdir(join(tmp.root(), 'sub'));
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    expect(await tmp.run(h, ['project', 'bind', 'pessoal', 'sub'])).toBe(0);
    h.out.length = 0;
    await tmp.run(h, ['project', 'list']);
    expect(h.out).toEqual([`${join(tmp.root(), 'sub')}  pessoal`]);
  });

  it('project bind of a missing path exits 1 with one line', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    expect(await tmp.run(h, ['project', 'bind', 'pessoal', 'gone'])).toBe(1);
    expect(h.err).toEqual([`Caminho não encontrado: ${join(tmp.root(), 'gone')}`]);
  });

  it('run in a deleted working directory exits 1 with one line', async () => {
    const h = makeHarness();
    const cwd = join(tmp.root(), 'gone');
    expect(await main({ argv: ['run'], env: tmp.env(), cwd, io: h.io })).toBe(1);
    expect(h.err).toEqual([`Caminho não encontrado: ${cwd}`]);
  });
});
