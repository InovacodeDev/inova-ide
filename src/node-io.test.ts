import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchSpec } from './core/launch.js';
import { nodeIO } from './node-io.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inova-nodeio-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function script(body: string): Promise<LaunchSpec> {
  const file = join(dir, 'fake.mjs');
  await writeFile(file, body);
  return { command: process.execPath, args: [file, join(dir, 'ready')], cwd: dir, env: {} };
}

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const content = await readFile(join(dir, 'ready'), 'utf8').catch(() => '');
    if (content === '1') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('fake child never became ready');
}

type Listener = (signal: NodeJS.Signals) => void;

function newListeners(signal: NodeJS.Signals, before: readonly unknown[]): Listener[] {
  const current: unknown[] = process.listeners(signal);
  return current.filter(
    (listener): listener is Listener =>
      typeof listener === 'function' && !before.includes(listener),
  );
}

const SIGNAL_NAMES: NodeJS.Signals[] = ['SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGHUP'];

function listenerCounts(): number[] {
  return SIGNAL_NAMES.map((signal) => process.listeners(signal).length);
}

const MARK_READY =
  "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], '1');\n";

describe('nodeIO.spawnInteractive', () => {
  it('passes the child exit code through', async () => {
    const spec = await script('process.exit(7);\n');
    expect(await nodeIO.spawnInteractive(spec)).toBe(7);
  });

  it('resolves not-found for a missing binary', async () => {
    const spec: LaunchSpec = {
      command: join(dir, 'does-not-exist'),
      args: [],
      cwd: dir,
      env: {},
    };
    expect(await nodeIO.spawnInteractive(spec)).toBe('not-found');
  });

  it('survives SIGINT and SIGQUIT in the parent while the child runs', async () => {
    const spec = await script(`setTimeout(() => process.exit(42), 400);\n${MARK_READY}`);
    const before = { int: process.listeners('SIGINT'), quit: process.listeners('SIGQUIT') };
    const pending = nodeIO.spawnInteractive(spec);
    const handlers = [
      ...newListeners('SIGINT', before.int),
      ...newListeners('SIGQUIT', before.quit),
    ];
    expect(handlers).toHaveLength(2);
    await ready();
    for (const handler of handlers) handler('SIGINT');
    expect(await pending).toBe(42);
  });

  it('forwards SIGTERM to the child', async () => {
    const spec = await script(
      `process.on('SIGTERM', () => process.exit(9));\nsetTimeout(() => process.exit(0), 5000);\n${MARK_READY}`,
    );
    const before = process.listeners('SIGTERM');
    const pending = nodeIO.spawnInteractive(spec);
    const [forward] = newListeners('SIGTERM', before);
    expect(forward).toBeDefined();
    await ready();
    forward?.('SIGTERM');
    expect(await pending).toBe(9);
  });

  it('removes its signal handlers when the child exits', async () => {
    const spec = await script('process.exit(0);\n');
    const before = listenerCounts();
    await nodeIO.spawnInteractive(spec);
    expect(listenerCounts()).toEqual(before);
  });
});
