import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStore } from './core/store.js';
import type { Account } from './core/types.js';
import { makeHarness, useTmpRoot } from './test-harness.js';

describe('inova account commands', () => {
  const tmp = useTmpRoot();

  it('account add then list shows logged-out', async () => {
    const h = makeHarness({
      run: async () => ({ exitCode: 0, stdout: '{"loggedIn":false}' }),
    });
    expect(await tmp.run(h, ['account', 'add', 'claude', 'pessoal'])).toBe(0);
    expect(h.out).toEqual(['Rode: inova account login pessoal']);
    h.out.length = 0;
    expect(await tmp.run(h, ['account', 'list'])).toBe(0);
    expect(h.out).toEqual(['pessoal  claude  logged-out']);
  });

  it('list strips API keys from the status env', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const h = makeHarness({
      run: async (cmd) => {
        seen.push(cmd.env);
        return { exitCode: 0, stdout: '{"loggedIn":true}' };
      },
    });
    tmp.setEnv({ ANTHROPIC_API_KEY: 'secret' });
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    await tmp.run(h, ['account', 'list']);
    expect(seen[0]?.['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('login spawns the provider login command', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    expect(await tmp.run(h, ['account', 'login', 'pessoal'])).toBe(0);
    expect(h.spawned[0]?.command).toBe('claude');
    expect(h.spawned[0]?.args).toEqual(['auth', 'login']);
  });

  it('gemini login prints the interactive hint', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'gemini', 'g']);
    await tmp.run(h, ['account', 'login', 'g']);
    expect(h.out).toContain(
      'No Antigravity (agy), conclua o login no navegador e saia com Ctrl+C.',
    );
  });

  it('login of a missing account exits 1', async () => {
    const h = makeHarness();
    expect(await tmp.run(h, ['account', 'login', 'nope'])).toBe(1);
    expect(h.err).toEqual(['Account not found: nope']);
  });

  it('rm removes an account', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'codex', 'c']);
    expect(await tmp.run(h, ['account', 'rm', 'c'])).toBe(0);
    h.out.length = 0;
    await tmp.run(h, ['account', 'list']);
    expect(h.out).toEqual([]);
  });

  it('rm of a claude account prints the keychain logout hint with its home', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'claude', 'pessoal']);
    const { homeDir } = (await loadStore(tmp.root())).accounts[0] as Account;
    h.out.length = 0;
    expect(await tmp.run(h, ['account', 'rm', 'pessoal'])).toBe(0);
    expect(h.out).toEqual([
      `Dica: rode antes "CLAUDE_CONFIG_DIR=${homeDir} claude auth logout" para remover a credencial do Keychain.`,
    ]);
  });

  it('rm of a codex account prints no hint', async () => {
    const h = makeHarness();
    await tmp.run(h, ['account', 'add', 'codex', 'c']);
    h.out.length = 0;
    await tmp.run(h, ['account', 'rm', 'c']);
    expect(h.out).toEqual([]);
  });

  it('corrupt store prints path and exits 1', async () => {
    await writeFile(join(tmp.root(), 'store.json'), '{nope');
    const h = makeHarness();
    expect(await tmp.run(h, ['account', 'list'])).toBe(1);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain(join(tmp.root(), 'store.json'));
  });

  it('unknown provider exits 1 listing valid providers', async () => {
    const h = makeHarness();
    expect(await tmp.run(h, ['account', 'add', 'foo', 'x'])).toBe(1);
    expect(h.err).toEqual([
      'Provedor inválido: foo. Use: claude, codex, gemini, deepseek, kimi, grok, qwen, opencode',
    ]);
  });

  it('unknown command exits 1 with usage', async () => {
    const h = makeHarness();
    expect(await tmp.run(h, ['bogus'])).toBe(1);
    expect(h.err[0]).toMatch(/^Uso: /);
  });

  it('missing args exit 1 with usage', async () => {
    const h = makeHarness();
    expect(await tmp.run(h, ['account', 'add', 'claude'])).toBe(1);
    expect(h.err[0]).toMatch(/^Uso: /);
  });

  it('--version and -v print package version and exit 0', async () => {
    const expected = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
      .version;
    for (const flag of ['--version', '-v']) {
      const h = makeHarness();
      expect(await tmp.run(h, [flag])).toBe(0);
      expect(h.out).toEqual([expected]);
      expect(h.err).toEqual([]);
    }
  });

  it('--help and -h print usage to stdout and exit 0', async () => {
    for (const flag of ['--help', '-h']) {
      const h = makeHarness();
      expect(await tmp.run(h, [flag])).toBe(0);
      expect(h.out[0]).toMatch(/^Uso: /);
      expect(h.err).toEqual([]);
    }
  });
});
