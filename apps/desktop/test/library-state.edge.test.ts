import { describe, expect, test } from 'vitest';
import type { LibraryItem, ProfileSyncApplyResult } from '../src/shared/api';
import { MESSAGES, translate } from '../src/renderer/i18n';
import {
  FORM_ERROR_KEYS,
  MAX_SKILL_BYTES,
  SECRET_HELP_EXAMPLE,
  buildSaveInput,
  emptyForm,
  formFromItem,
  toggleInput,
  type LibraryFormState,
} from '../src/renderer/library-form';
import {
  accountsForProvider,
  applyableIds,
  approvalWarningKey,
  canPreviewSync,
  groupLibraryItems,
  itemDetail,
  libraryIdTaken,
  needsApproval,
  pluginInstallState,
  projectItemRows,
  recipeFor,
  reasonText,
  selectionSummary,
  statusPresentation,
  summarizeApply,
  syncAccountSelection,
  toggleId,
} from '../src/renderer/library-state';

const NOW = '2026-11-17T00:00:00.000Z';

function base(id: string, name: string, enabled = true) {
  return { id, name, description: null, enabled, source: 'created' as const, updatedAt: NOW };
}

function skillItem(id: string, name: string, enabled = true): LibraryItem {
  return { ...base(id, name, enabled), kind: 'skill', definition: { hash: 'b'.repeat(64) } };
}

function form(kind: LibraryFormState['kind'], patch: Partial<LibraryFormState>): LibraryFormState {
  return { ...emptyForm(kind), id: 'item-one', name: 'Item', ...patch };
}

function failureCode(state: LibraryFormState): string | undefined {
  const result = buildSaveInput(state);
  return result.ok ? undefined : result.code;
}

describe('form common fields', () => {
  test('rejects invalid ids and accepts slugs', () => {
    const invalid = ['', 'Upper', 'with space', '-lead', 'trail-', 'a--b', 'a_b', 'x'.repeat(65)];
    for (const id of invalid) {
      expect(failureCode(form('plugin', { id, pluginName: 'p' }))).toBe('id-invalid');
    }
    for (const id of ['a', 'a-b', 'skill-2', 'x'.repeat(64)]) {
      expect(buildSaveInput(form('plugin', { id, pluginName: 'p' })).ok).toBe(true);
    }
  });

  test('requires a name and bounds name and description', () => {
    expect(failureCode(form('plugin', { name: '  ', pluginName: 'p' }))).toBe('name-required');
    expect(failureCode(form('plugin', { name: 'n'.repeat(101), pluginName: 'p' }))).toBe(
      'name-too-long',
    );
    expect(failureCode(form('plugin', { description: 'd'.repeat(501), pluginName: 'p' }))).toBe(
      'description-too-long',
    );
  });

  test('turns an empty description into null and trims the rest', () => {
    const result = buildSaveInput(
      form('plugin', { id: ' item-one ', name: ' Item ', pluginName: 'p' }),
    );
    expect(result).toMatchObject({
      ok: true,
      input: { id: 'item-one', name: 'Item', description: null, enabled: true },
    });
  });
});

describe('skill form', () => {
  test('requires content when creating', () => {
    expect(failureCode(form('skill', { skillContent: '   \n' }))).toBe('content-required');
  });

  test('keeps the current content when editing with an empty field', () => {
    const result = buildSaveInput(form('skill', { editing: true, skillContent: '' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect('content' in result.input).toBe(false);
  });

  test('sends new content when editing with a filled field', () => {
    const result = buildSaveInput(
      form('skill', { editing: true, skillContent: '---\nname: a\n---' }),
    );
    expect(result).toMatchObject({
      ok: true,
      input: { kind: 'skill', content: '---\nname: a\n---' },
    });
  });

  test('bounds the SKILL.md size in bytes, not characters', () => {
    const atLimit = 'a'.repeat(MAX_SKILL_BYTES);
    expect(buildSaveInput(form('skill', { skillContent: atLimit })).ok).toBe(true);
    expect(failureCode(form('skill', { skillContent: `${atLimit}a` }))).toBe('content-too-large');
    const multibyte = 'é'.repeat(MAX_SKILL_BYTES / 2 + 1);
    expect(multibyte.length).toBeLessThan(MAX_SKILL_BYTES);
    expect(failureCode(form('skill', { skillContent: multibyte }))).toBe('content-too-large');
  });
});

describe('mcp and connector form', () => {
  test('requires a command for stdio and drops blank argument lines', () => {
    expect(failureCode(form('mcp', { command: '  ' }))).toBe('command-required');
    expect(failureCode(form('mcp', { command: 'c'.repeat(501) }))).toBe('command-too-long');
    const none = buildSaveInput(form('mcp', { command: 'npx', args: '' }));
    const blank = buildSaveInput(form('mcp', { command: 'npx', args: '\n  \n\t\n' }));
    for (const result of [none, blank]) {
      expect(result.ok && 'args' in (result.input as { definition: object }).definition).toBe(
        false,
      );
    }
    const lines = buildSaveInput(form('mcp', { command: 'npx', args: '-y\n\n pkg \r\n--flag\n' }));
    expect(lines).toMatchObject({
      ok: true,
      input: { definition: { command: 'npx', args: ['-y', 'pkg', '--flag'] } },
    });
  });

  test('bounds the number and the length of arguments', () => {
    const many = Array.from({ length: 51 }, (_, index) => `a${index}`).join('\n');
    expect(failureCode(form('mcp', { command: 'npx', args: many }))).toBe('args-too-many');
    expect(failureCode(form('mcp', { command: 'npx', args: 'x'.repeat(1001) }))).toBe(
      'arg-too-long',
    );
  });

  test('rejects duplicate env keys, a value without key and a key without reference', () => {
    const duplicate = form('mcp', {
      command: 'npx',
      env: [
        { key: 'TOKEN', value: '${A}' },
        { key: ' TOKEN ', value: '${B}' },
      ],
    });
    expect(buildSaveInput(duplicate)).toMatchObject({
      ok: false,
      code: 'pair-key-duplicate',
      detail: 'TOKEN',
    });
    expect(failureCode(form('mcp', { command: 'npx', env: [{ key: '', value: '${A}' }] }))).toBe(
      'pair-key-required',
    );
    expect(failureCode(form('mcp', { command: 'npx', env: [{ key: 'TOKEN', value: '' }] }))).toBe(
      'pair-value-reference',
    );
  });

  test('reports a literal value as a missing reference on env and headers', () => {
    const rows = [{ key: 'TOKEN', value: 'ghp_abcdefghijklmnopqrstuvwxyz123456' }];
    expect(failureCode(form('mcp', { command: 'npx', env: rows }))).toBe('pair-value-reference');
    expect(
      failureCode(form('mcp', { transport: 'http', url: 'https://example.com', headers: rows })),
    ).toBe('pair-value-reference');
  });

  test('detects an id that already exists in the library', () => {
    const items = [skillItem('taken', 'Taken')];
    expect(libraryIdTaken({ items, id: 'taken' })).toBe(true);
    expect(libraryIdTaken({ items, id: 'free' })).toBe(false);
    expect(libraryIdTaken({ items: [], id: 'taken' })).toBe(false);
  });

  test('never echoes the rejected value in the error detail', () => {
    const result = buildSaveInput(
      form('mcp', { command: 'npx', env: [{ key: 'TOKEN', value: 'super-secret-value' }] }),
    );
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });

  test('skips fully blank pair rows and omits empty env and headers', () => {
    const result = buildSaveInput(form('mcp', { command: 'npx', env: [{ key: '', value: '  ' }] }));
    expect(result).toMatchObject({ ok: true, input: { definition: { command: 'npx' } } });
    expect(result.ok && 'env' in (result.input as { definition: object }).definition).toBe(false);
  });

  test('keeps __proto__ as a plain key instead of changing the prototype', () => {
    const result = buildSaveInput(
      form('mcp', { command: 'npx', env: [{ key: '__proto__', value: '${A}' }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.input.kind === 'mcp' && 'env' in result.input.definition) {
      const { env } = result.input.definition;
      expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
      expect(Object.keys(env ?? {})).toEqual(['__proto__']);
    }
  });

  test('requires a valid http or https url for remote servers', () => {
    const remote = (url: string) => form('mcp', { transport: 'http', url });
    expect(failureCode(remote(''))).toBe('url-required');
    expect(failureCode(remote('   '))).toBe('url-required');
    expect(failureCode(remote('not a url'))).toBe('url-invalid');
    expect(failureCode(remote('ftp://example.com/x'))).toBe('url-invalid');
    expect(failureCode(remote(`https://example.com/${'x'.repeat(2000)}`))).toBe('url-invalid');
    expect(buildSaveInput(remote(' https://example.com/mcp ')).ok).toBe(true);
  });

  test('a connector needs a label and builds an sse definition', () => {
    const connector = form('connector', { transport: 'sse', url: 'https://example.com/sse' });
    expect(failureCode(connector)).toBe('label-required');
    expect(buildSaveInput({ ...connector, label: ' Docs ' })).toMatchObject({
      ok: true,
      input: {
        kind: 'connector',
        label: 'Docs',
        definition: { type: 'sse', url: 'https://example.com/sse' },
      },
    });
  });
});

describe('plugin form', () => {
  test('requires a name and omits a blank marketplace', () => {
    expect(failureCode(form('plugin', { pluginName: '  ' }))).toBe('plugin-name-required');
    expect(
      buildSaveInput(form('plugin', { pluginName: ' feature-dev ', marketplace: ' ' })),
    ).toEqual({
      ok: true,
      input: {
        kind: 'plugin',
        id: 'item-one',
        name: 'Item',
        description: null,
        enabled: true,
        definition: { provider: 'claude', name: 'feature-dev' },
      },
    });
    expect(
      buildSaveInput(form('plugin', { provider: 'codex', pluginName: 'p', marketplace: 'mkt' })),
    ).toMatchObject({ ok: true, input: { definition: { provider: 'codex', marketplace: 'mkt' } } });
  });
});

describe('editing and toggling an existing item', () => {
  const mcp: LibraryItem = {
    ...base('github', 'GitHub'),
    kind: 'mcp',
    definition: { command: 'npx', args: ['-y', 'pkg'], env: { TOKEN: '${GITHUB_TOKEN}' } },
  };
  const connector: LibraryItem = {
    ...base('docs', 'Docs'),
    kind: 'connector',
    label: 'Docs',
    definition: { type: 'http', url: 'https://example.com/mcp', headers: { A: 'Bearer ${T}' } },
  };

  test('round-trips an mcp item through the form', () => {
    const state = formFromItem(mcp);
    expect(state).toMatchObject({ editing: true, id: 'github', command: 'npx', args: '-y\npkg' });
    expect(buildSaveInput(state)).toMatchObject({
      ok: true,
      input: { kind: 'mcp', definition: mcp.kind === 'mcp' ? mcp.definition : null },
    });
  });

  test('round-trips a connector and a remote mcp item', () => {
    expect(buildSaveInput(formFromItem(connector))).toMatchObject({
      ok: true,
      input: { kind: 'connector', label: 'Docs' },
    });
    const remote: LibraryItem = {
      ...base('remote', 'Remote'),
      kind: 'mcp',
      definition: { type: 'sse', url: 'https://example.com/sse' },
    };
    expect(formFromItem(remote)).toMatchObject({
      transport: 'sse',
      url: 'https://example.com/sse',
    });
  });

  test('toggling a skill omits the content, toggling others resends definition and label', () => {
    const skill = toggleInput(skillItem('s', 'S'), false);
    expect(skill).toEqual({
      kind: 'skill',
      id: 's',
      name: 'S',
      description: null,
      enabled: false,
    });
    expect(toggleInput(connector, false)).toMatchObject({
      kind: 'connector',
      label: 'Docs',
      enabled: false,
      definition: { url: 'https://example.com/mcp' },
    });
    expect(toggleInput(mcp, true)).toMatchObject({ kind: 'mcp', enabled: true });
  });

  test('describes items for the list', () => {
    expect(itemDetail(skillItem('s', 'S'))).toBe('');
    expect(itemDetail(mcp)).toBe('npx');
    expect(itemDetail(connector)).toBe('Docs · https://example.com/mcp');
    const plugin: LibraryItem = {
      ...base('p', 'P'),
      kind: 'plugin',
      definition: { provider: 'claude', marketplace: 'mkt', name: 'dev' },
    };
    expect(itemDetail(plugin)).toBe('claude · dev@mkt');
  });
});

describe('grouping and ordering', () => {
  test('orders groups by kind, items by name ignoring case, and ties by id', () => {
    const items = [
      skillItem('z-id', 'beta'),
      skillItem('b-id', 'Alpha'),
      skillItem('a-id', 'alpha'),
      { ...base('m', 'M'), kind: 'mcp', definition: { command: 'x' } } as LibraryItem,
    ];
    const snapshot = items.map((item) => item.id);
    const groups = groupLibraryItems(items);
    expect(groups.map((group) => group.kind)).toEqual(['skill', 'mcp']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a-id', 'b-id', 'z-id']);
    expect(items.map((item) => item.id)).toEqual(snapshot);
    expect(groupLibraryItems([...items].reverse())[0]?.items.map((item) => item.id)).toEqual([
      'a-id',
      'b-id',
      'z-id',
    ]);
  });

  test('returns no groups for an empty library', () => {
    expect(groupLibraryItems([])).toEqual([]);
  });
});

describe('project panel without overrides', () => {
  test('treats a project without libraryDisabled as having nothing disabled', () => {
    const rows = projectItemRows({ items: [skillItem('a', 'A'), skillItem('b', 'B', false)] });
    expect(rows.map((row) => [row.item.id, row.status])).toEqual([
      ['a', 'effective'],
      ['b', 'library-off'],
    ]);
  });

  test('ignores overrides for items that no longer exist', () => {
    const rows = projectItemRows({ items: [skillItem('a', 'A')], projectDisabled: ['gone'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.effective).toBe(true);
  });
});

describe('sync selection', () => {
  test('an empty preview selects nothing', () => {
    expect(selectionSummary({ items: [], approvedIds: [] })).toEqual({
      autoCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      willApplyCount: 0,
    });
    expect(applyableIds({ items: [], approvedIds: ['x'] })).toEqual([]);
  });

  test('counts creates as automatic and approvals as explicit', () => {
    const items = [
      { id: 'c', status: 'create', approvalKey: 'c' },
      { id: 'u', status: 'update', approvalKey: 'u' },
      { id: 'k', status: 'conflict', approvalKey: 'k' },
      { id: 'r', status: 'remove', approvalKey: 'r' },
      { id: 'i', status: 'incompatible', approvalKey: 'i' },
    ];
    expect(selectionSummary({ items, approvedIds: ['u'] })).toEqual({
      autoCount: 1,
      approvedCount: 1,
      pendingCount: 2,
      willApplyCount: 2,
    });
  });

  test('deduplicates repeated approvals and ignores ids outside the preview', () => {
    const items = [
      { id: 'u', status: 'update', approvalKey: 'u' },
      { id: 'u', status: 'update', approvalKey: 'u' },
    ];
    expect(applyableIds({ items, approvedIds: ['u', 'u', 'ghost'] })).toEqual(['u']);
    expect(selectionSummary({ items, approvedIds: ['u', 'u'] }).pendingCount).toBe(0);
  });

  test('does not break on an unknown status', () => {
    for (const status of ['weird', 'constructor', '__proto__', '']) {
      const presentation = statusPresentation(status);
      expect(presentation).toMatchObject({ known: false, labelKey: 'library.status.unknown' });
      expect(needsApproval({ status })).toBe(false);
    }
    const items = [{ id: 'w', status: 'weird', approvalKey: 'w' }];
    expect(selectionSummary({ items, approvedIds: ['w'] }).willApplyCount).toBe(0);
    expect(reasonText({ item: { id: 'w', status: 'weird' }, fallback: 'f' })).toBeNull();
  });

  test('gives every known status a label, an icon and a tone', () => {
    for (const status of ['create', 'update', 'unchanged', 'conflict', 'incompatible', 'remove']) {
      expect(statusPresentation(status).known).toBe(true);
    }
    expect(statusPresentation('incompatible').tone).toBe('error');
  });

  test('warns explicitly for conflict and remove only', () => {
    expect(approvalWarningKey('conflict')).toBe('library.sync.warnConflict');
    expect(approvalWarningKey('remove')).toBe('library.sync.warnRemove');
    expect(approvalWarningKey('update')).toBeNull();
  });

  test('shows the reason of a conflict when it exists and nothing when it does not', () => {
    expect(reasonText({ item: { id: 'k', status: 'conflict' }, fallback: 'f' })).toBeNull();
    expect(
      reasonText({
        item: { id: 'k', status: 'conflict', reason: ' Existe sem marcador. ' },
        fallback: 'f',
      }),
    ).toBe('Existe sem marcador.');
  });

  test('toggles ids without mutating the list', () => {
    const ids = ['a'];
    expect(toggleId(ids, 'b')).toEqual(['a', 'b']);
    expect(toggleId(ids, 'a')).toEqual([]);
    expect(ids).toEqual(['a']);
  });

  test('requests all accounts by omitting the list', () => {
    expect(syncAccountSelection({ allIds: ['a', 'b'], excludedIds: [] })).toEqual({
      ids: ['a', 'b'],
      request: undefined,
    });
    expect(syncAccountSelection({ allIds: ['a', 'b'], excludedIds: ['b'] })).toEqual({
      ids: ['a'],
      request: ['a'],
    });
    expect(syncAccountSelection({ allIds: [], excludedIds: [] }).request).toBeUndefined();
  });

  test('blocks the preview without a project or without any selected account', () => {
    expect(canPreviewSync({ projectId: null, accountCount: 1, selectedCount: 1 })).toBe(false);
    expect(canPreviewSync({ projectId: 'p', accountCount: 2, selectedCount: 0 })).toBe(false);
    expect(canPreviewSync({ projectId: 'p', accountCount: 2, selectedCount: 1 })).toBe(true);
    expect(canPreviewSync({ projectId: 'p', accountCount: 0, selectedCount: 0 })).toBe(true);
  });
});

describe('apply result', () => {
  test('reduces applied and skipped ids and keeps the backup directory', () => {
    const result: ProfileSyncApplyResult = {
      backupDir: '/tmp/backups/1',
      appliedIds: ['a', 'a', 'b'],
      skippedIds: ['b', 'c', 'c', 'd'],
    };
    expect(summarizeApply(result)).toEqual({
      appliedIds: ['a', 'b'],
      skippedIds: ['c', 'd'],
      appliedCount: 2,
      skippedCount: 2,
      backupDir: '/tmp/backups/1',
    });
  });

  test('handles an apply that skipped everything', () => {
    expect(summarizeApply({ backupDir: '', appliedIds: [], skippedIds: ['x'] })).toMatchObject({
      appliedCount: 0,
      skippedCount: 1,
    });
  });
});

describe('plugin install', () => {
  const account = (id: string, provider: string) => ({ id, provider });

  test('filters accounts of the same provider', () => {
    const accounts = [account('1', 'claude'), account('2', 'codex'), account('3', 'claude')];
    expect(accountsForProvider(accounts, 'claude').map((entry) => entry.id)).toEqual(['1', '3']);
  });

  test('is ready only with a valid recipe and an account', () => {
    const ok = { ok: true, commandId: 'claude.plugin.install', params: { name: 'dev' } } as const;
    expect(pluginInstallState({ recipe: ok, accountCount: 1 })).toEqual({
      kind: 'ready',
      commandId: 'claude.plugin.install',
      params: { name: 'dev' },
    });
    expect(pluginInstallState({ recipe: ok, accountCount: 0 })).toEqual({ kind: 'no-account' });
  });

  test('shows the reason of an unsupported provider and survives a missing recipe', () => {
    expect(
      pluginInstallState({ recipe: { ok: false, reason: 'Qwen usa extensões.' }, accountCount: 1 }),
    ).toEqual({ kind: 'unsupported', reason: 'Qwen usa extensões.' });
    expect(pluginInstallState({ recipe: undefined, accountCount: 1 })).toEqual({
      kind: 'unsupported',
      reason: null,
    });
  });

  test('looks recipes up by own key only', () => {
    const recipes = { dev: { ok: false, reason: 'x' } } as const;
    expect(recipeFor(recipes, 'dev')).toEqual({ ok: false, reason: 'x' });
    expect(recipeFor(recipes, 'constructor')).toBeUndefined();
    expect(recipeFor(undefined, 'dev')).toBeUndefined();
  });
});

describe('library i18n', () => {
  test('every form error code has a key with text in both locales', () => {
    for (const key of Object.values(FORM_ERROR_KEYS)) {
      expect(MESSAGES['pt-BR'][key].length).toBeGreaterThan(0);
      expect(MESSAGES['en-US'][key].length).toBeGreaterThan(0);
    }
  });

  test('the secret help text names the variable only, in both locales', () => {
    for (const locale of ['pt-BR', 'en-US'] as const) {
      const text = translate(locale, 'library.form.secretHelp', { example: SECRET_HELP_EXAMPLE });
      expect(text).toContain('${GITHUB_TOKEN}');
    }
    expect(
      translate('pt-BR', 'library.form.secretHelp', { example: SECRET_HELP_EXAMPLE }),
    ).toContain('A IDE nunca guarda o valor do segredo.');
  });

  test('the remove warning mentions the next sync after the preview', () => {
    expect(translate('pt-BR', 'library.remove.description', { name: 'x' })).toContain(
      'As cópias já aplicadas nos providers saem na próxima sincronização, após o preview.',
    );
  });
});
