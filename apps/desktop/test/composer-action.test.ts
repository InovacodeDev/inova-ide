import { expect, test } from 'vitest';
import { composerPrimaryAction } from '../src/renderer/composer-action.js';

test('idle composer always shows send', () => {
  expect(composerPrimaryAction({ running: false, hasContent: false, canEnqueue: true })).toBe(
    'send',
  );
  expect(composerPrimaryAction({ running: false, hasContent: true, canEnqueue: false })).toBe(
    'send',
  );
});

test('running composer shows stop until there is something to queue', () => {
  expect(composerPrimaryAction({ running: true, hasContent: false, canEnqueue: true })).toBe(
    'stop',
  );
  expect(composerPrimaryAction({ running: true, hasContent: true, canEnqueue: true })).toBe(
    'enqueue',
  );
});

test('running composer keeps stop when queueing is not available', () => {
  expect(composerPrimaryAction({ running: true, hasContent: true, canEnqueue: false })).toBe(
    'stop',
  );
});
