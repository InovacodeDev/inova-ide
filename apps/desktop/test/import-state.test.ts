import { expect, test } from 'vitest';
import { buildImportGroups, formatBytes, selectableIds } from '../src/renderer/import-state.js';
import type { AccountView, ExternalSessionView } from '../src/shared/api.js';

function account(input: Pick<AccountView, 'id' | 'label' | 'provider'>): AccountView {
  return { ...input, email: null, status: 'logged-in' };
}

function external(
  input: Pick<ExternalSessionView, 'id' | 'provider'> & { imported?: boolean },
): ExternalSessionView {
  return {
    title: input.id,
    updatedAt: '2026-11-01T00:00:00.000Z',
    sizeBytes: 10,
    imported: false,
    ...input,
  };
}

const accounts = [
  account({ id: 'a1', label: 'pessoal', provider: 'claude' }),
  account({ id: 'a2', label: 'trabalho', provider: 'claude' }),
];

test('groups sessions by provider and defaults to the project account', () => {
  const groups = buildImportGroups({
    sessions: [
      external({ id: 's1', provider: 'claude' }),
      external({ id: 's2', provider: 'codex' }),
      external({ id: 's3', provider: 'claude', imported: true }),
    ],
    accounts,
    projectProvider: 'claude',
    projectAccountLabel: 'trabalho',
  });
  expect(groups.map((group) => group.provider)).toEqual(['claude', 'codex']);
  expect(groups[0]?.defaultAccountId).toBe('a2');
  expect(groups[0] && selectableIds(groups[0])).toEqual(['s1']);
  expect(groups[1]?.accounts).toEqual([]);
  expect(groups[1]?.defaultAccountId).toBe('');
  expect(groups[1] && selectableIds(groups[1])).toEqual([]);
});

test('falls back to the first account of the provider when the project uses another provider', () => {
  const [group] = buildImportGroups({
    sessions: [external({ id: 's1', provider: 'claude' })],
    accounts,
    projectProvider: 'codex',
    projectAccountLabel: 'pessoal',
  });
  expect(group?.defaultAccountId).toBe('a1');
});

test('formats file sizes', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
});
