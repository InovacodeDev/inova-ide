import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LibraryValidationError,
  loadLibrary,
  removeLibraryItem,
  resolveEffectiveItems,
  saveLibraryItem,
  setLibraryItemEnabled,
  validateLibraryItem,
  type LibraryItem,
} from './index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inova-library-contract-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const UPDATED_AT = '2026-11-17T10:00:00.000Z';

function skillItem(id: string, enabled = true): LibraryItem {
  return {
    id,
    kind: 'skill',
    name: id,
    description: null,
    enabled,
    source: 'created',
    definition: { hash: 'a1b2c3d4e5f60718' },
    updatedAt: UPDATED_AT,
  };
}

function mcpItem(definition: Record<string, unknown>): unknown {
  return {
    id: 'server',
    kind: 'mcp',
    name: 'Server',
    description: null,
    enabled: true,
    source: 'created',
    definition,
    updatedAt: UPDATED_AT,
  };
}

function connectorItem(definition: Record<string, unknown>): unknown {
  return {
    id: 'remote',
    kind: 'connector',
    name: 'Remote',
    label: 'Remote',
    description: null,
    enabled: true,
    source: 'created',
    definition,
    updatedAt: UPDATED_AT,
  };
}

async function backupContents(): Promise<string[]> {
  const base = join(root, 'backups', 'library');
  const dirs = await readdir(base).catch(() => []);
  return Promise.all(dirs.map((dir) => readFile(join(base, dir, 'library.json'), 'utf8')));
}

async function leftoverTempFiles(): Promise<string[]> {
  const entries = await readdir(join(root, 'library'));
  return entries.filter((name) => name.endsWith('.tmp'));
}

describe('library business rules', () => {
  it('rule 1: an item disabled in the library never reaches a provider', () => {
    const items = [skillItem('on'), skillItem('off', false)];
    const effective = resolveEffectiveItems({ items, projectDisabled: [], accountDisabled: [] });
    expect(effective.map((item) => item.id)).toEqual(['on']);
  });

  it('rule 2: effective item is on in the library, on in the project and on in the account', () => {
    const items = [skillItem('all-on'), skillItem('project-off'), skillItem('account-off')];
    const effective = resolveEffectiveItems({
      items,
      projectDisabled: ['project-off'],
      accountDisabled: [{ kind: 'skill', id: 'account-off' }],
    });
    expect(effective.map((item) => item.id)).toEqual(['all-on']);
  });

  it('rule 5: every write backs up the previous file and leaves a valid file with no temp', async () => {
    await saveLibraryItem({ root, item: skillItem('first') });
    const afterFirst = await readFile(join(root, 'library', 'library.json'), 'utf8');
    expect(await backupContents()).toEqual([]);

    await saveLibraryItem({ root, item: skillItem('second') });
    expect(await backupContents()).toEqual([afterFirst]);

    const afterSecond = await readFile(join(root, 'library', 'library.json'), 'utf8');
    await setLibraryItemEnabled({ root, id: 'first', enabled: false });
    expect(await backupContents()).toContain(afterSecond);
    expect(await backupContents()).toHaveLength(2);

    const afterToggle = await readFile(join(root, 'library', 'library.json'), 'utf8');
    await removeLibraryItem({ root, id: 'second' });
    expect(await backupContents()).toContain(afterToggle);
    expect(await backupContents()).toHaveLength(3);

    expect(await leftoverTempFiles()).toEqual([]);
    expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['first']);
  });

  describe('rule 6: the library never stores a secret value', () => {
    const rejected: Record<string, unknown> = {
      'literal env value': mcpItem({ command: 'npx', env: { API_KEY: 'sk-live-123456' } }),
      'literal header value': connectorItem({
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer sk-live-123456' },
      }),
      'token in the url query': connectorItem({
        type: 'sse',
        url: 'https://example.com/mcp?token=sk-live-123456',
      }),
      'token in the url credentials': connectorItem({
        type: 'http',
        url: 'https://user:sk-live-123456@example.com/mcp',
      }),
      'secret that masking would change': mcpItem({
        command: 'node',
        args: ['--header', 'Authorization: Bearer sk-live-123456'],
      }),
    };

    for (const [label, item] of Object.entries(rejected)) {
      it(`rejects ${label} and writes nothing to disk`, async () => {
        expect(validateLibraryItem(item).ok).toBe(false);
        await expect(saveLibraryItem({ root, item: item as LibraryItem })).rejects.toBeInstanceOf(
          LibraryValidationError,
        );
        expect(await readdir(root)).toEqual([]);
      });
    }

    it('accepts ${VAR} and Bearer ${VAR} references', async () => {
      const mcp = mcpItem({ command: 'npx', args: ['server'], env: { API_KEY: '${API_KEY}' } });
      const connector = connectorItem({
        type: 'http',
        url: 'https://example.com/mcp?key=${EXAMPLE_KEY}',
        headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' },
      });
      await saveLibraryItem({ root, item: mcp as LibraryItem });
      await saveLibraryItem({ root, item: connector as LibraryItem });
      expect((await loadLibrary(root)).items.map((item) => item.id)).toEqual(['server', 'remote']);
    });
  });
});
