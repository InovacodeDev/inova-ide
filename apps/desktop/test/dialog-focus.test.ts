import { describe, expect, test } from 'vitest';
import { resolveDialogTabTarget } from '../src/renderer/useDialogFocus';

describe('resolveDialogTabTarget', () => {
  const container = { id: 'card' };
  const first = { id: 'first' };
  const middle = { id: 'middle' };
  const last = { id: 'last' };

  test('keeps focus on container when there are no focusable children', () => {
    expect(
      resolveDialogTabTarget({
        focusables: [],
        container,
        active: container,
        containsActive: true,
        shiftKey: false,
      }),
    ).toBe(container);
  });

  test('moves outside focus into first or last child depending on Shift', () => {
    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: null,
        containsActive: false,
        shiftKey: false,
      }),
    ).toBe(first);

    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: null,
        containsActive: false,
        shiftKey: true,
      }),
    ).toBe(last);
  });

  test('wraps forward from last element to first element', () => {
    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: last,
        containsActive: true,
        shiftKey: false,
      }),
    ).toBe(first);
  });

  test('wraps backward from first element or container to last element', () => {
    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: first,
        containsActive: true,
        shiftKey: true,
      }),
    ).toBe(last);

    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: container,
        containsActive: true,
        shiftKey: true,
      }),
    ).toBe(last);
  });

  test('returns null for intermediate elements so browser Tab order advances naturally', () => {
    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: middle,
        containsActive: true,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(
      resolveDialogTabTarget({
        focusables: [first, middle, last],
        container,
        active: middle,
        containsActive: true,
        shiftKey: true,
      }),
    ).toBeNull();
  });
});
