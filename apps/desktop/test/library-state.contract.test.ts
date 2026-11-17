import { describe, expect, test } from 'vitest';
import type { LibraryItem } from '../src/shared/api';
import {
  buildSaveInput,
  emptyForm,
  isVariableReference,
  type KeyValueRow,
  type LibraryFormState,
} from '../src/renderer/library-form';
import {
  applyableIds,
  needsApproval,
  projectItemRows,
  reasonText,
} from '../src/renderer/library-state';

function skill(input: { id: string; enabled: boolean }): LibraryItem {
  return {
    kind: 'skill',
    id: input.id,
    name: input.id,
    description: null,
    enabled: input.enabled,
    source: 'created',
    updatedAt: '2026-11-17T00:00:00.000Z',
    definition: { hash: 'a'.repeat(64) },
  };
}

function stdioForm(env: KeyValueRow[]): LibraryFormState {
  return { ...emptyForm('mcp'), id: 'github', name: 'GitHub', command: 'npx', env };
}

function httpForm(headers: KeyValueRow[]): LibraryFormState {
  return {
    ...emptyForm('mcp'),
    id: 'remote',
    name: 'Remote',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers,
  };
}

function connectorForm(headers: KeyValueRow[]): LibraryFormState {
  return {
    ...emptyForm('connector'),
    id: 'docs',
    name: 'Docs',
    label: 'Docs',
    url: 'https://example.com/sse',
    transport: 'sse',
    headers,
  };
}

describe('rule 2: effective item in the project panel', () => {
  test('an item is effective only when it is on in the library and not off in the project', () => {
    const rows = projectItemRows({
      items: [
        skill({ id: 'on-everywhere', enabled: true }),
        skill({ id: 'off-in-project', enabled: true }),
        skill({ id: 'off-in-library', enabled: false }),
      ],
      projectDisabled: ['off-in-project'],
    });
    const effective = Object.fromEntries(rows.map((row) => [row.item.id, row.effective]));
    expect(effective).toEqual({
      'on-everywhere': true,
      'off-in-project': false,
      'off-in-library': false,
    });
  });

  test('an item off in the library is shown as off in the library, even if the project lists it', () => {
    const rows = projectItemRows({
      items: [skill({ id: 'off-in-library', enabled: false })],
      projectDisabled: ['off-in-library'],
    });
    expect(rows[0]).toMatchObject({ status: 'library-off', effective: false });
  });
});

describe('approval of sync items', () => {
  test('needsApproval is true for update, conflict and remove', () => {
    for (const status of ['update', 'conflict', 'remove']) {
      expect(needsApproval({ status })).toBe(true);
    }
  });

  test('needsApproval is false for create, unchanged and incompatible', () => {
    for (const status of ['create', 'unchanged', 'incompatible']) {
      expect(needsApproval({ status })).toBe(false);
    }
  });

  test('applyableIds never includes an item without explicit approval', () => {
    const items = ['create', 'update', 'unchanged', 'conflict', 'incompatible', 'remove'].map(
      (status) => ({ id: `item-${status}`, status }),
    );
    expect(applyableIds({ items, approvedIds: [] })).toEqual([]);
    expect(applyableIds({ items, approvedIds: ['item-conflict'] })).toEqual(['item-conflict']);
    const everything = items.map((item) => item.id);
    expect(applyableIds({ items, approvedIds: everything }).sort()).toEqual([
      'item-conflict',
      'item-remove',
      'item-update',
    ]);
  });
});

describe('rule 6: the form never produces a secret literal', () => {
  const literals = ['ghp_abcdefghijklmnopqrstuvwxyz123456', 'hunter2', 'Bearer abc123', '$TOKEN'];

  test('accepts only ${VAR} or Word ${VAR} as value', () => {
    expect(isVariableReference('${GITHUB_TOKEN}')).toBe(true);
    expect(isVariableReference('Bearer ${API_TOKEN}')).toBe(true);
    for (const literal of [...literals, '', '${}', 'prefix${TOKEN}', '${TOKEN} suffix']) {
      expect(isVariableReference(literal)).toBe(false);
    }
  });

  test('rejects a literal in env, in mcp headers and in connector headers', () => {
    for (const literal of literals) {
      const rows = [{ key: 'TOKEN', value: literal }];
      for (const form of [stdioForm(rows), httpForm(rows), connectorForm(rows)]) {
        expect(buildSaveInput(form)).toMatchObject({ ok: false, code: 'pair-value-reference' });
      }
    }
  });

  test('keeps a reference untouched in the produced input', () => {
    const result = buildSaveInput(stdioForm([{ key: 'GITHUB_TOKEN', value: '${GITHUB_TOKEN}' }]));
    expect(result).toMatchObject({
      ok: true,
      input: { kind: 'mcp', definition: { env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } } },
    });
    const headers = buildSaveInput(httpForm([{ key: 'Authorization', value: 'Bearer ${TOKEN}' }]));
    expect(headers).toMatchObject({
      ok: true,
      input: { definition: { headers: { Authorization: 'Bearer ${TOKEN}' } } },
    });
  });
});

describe('rule 7: incompatible items carry a displayable reason', () => {
  test('always returns a non-empty text for an incompatible item', () => {
    const fallback = 'Sem motivo informado.';
    for (const reason of [undefined, '', '   ']) {
      const item = { id: 'x', status: 'incompatible', ...(reason === undefined ? {} : { reason }) };
      expect(reasonText({ item, fallback })).toBe(fallback);
    }
  });

  test('returns the reason of the core when it exists', () => {
    const item = { id: 'x', status: 'incompatible', reason: 'Qwen não tem skills.' };
    expect(reasonText({ item, fallback: 'fallback' })).toBe('Qwen não tem skills.');
  });
});
