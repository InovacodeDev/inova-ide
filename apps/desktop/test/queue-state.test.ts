import { expect, test } from 'vitest';
import {
  isAccountBusyElsewhere,
  queueCountLabel,
  queuedCardLabel,
} from '../src/renderer/queue-state.js';

test('queueCountLabel uses the same copy for singular and plural', () => {
  expect(queueCountLabel(1)).toBe('1 na fila');
  expect(queueCountLabel(3)).toBe('3 na fila');
});

test('queuedCardLabel mentions the account only when it waits for it', () => {
  expect(queuedCardLabel(false)).toBe('Na fila');
  expect(queuedCardLabel(true)).toBe('Na fila — aguardando conta ficar livre');
});

test('isAccountBusyElsewhere ignores the own session and other accounts', () => {
  const runningAccounts = new Map<string, string | undefined>([
    ['s1', 'acc-1'],
    ['s2', 'acc-2'],
    ['s3', undefined],
  ]);
  expect(isAccountBusyElsewhere({ sessionId: 's1', accountId: 'acc-1', runningAccounts })).toBe(
    false,
  );
  expect(isAccountBusyElsewhere({ sessionId: 's1', accountId: 'acc-2', runningAccounts })).toBe(
    true,
  );
  expect(isAccountBusyElsewhere({ sessionId: 's1', accountId: undefined, runningAccounts })).toBe(
    false,
  );
});
