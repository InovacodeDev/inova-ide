import { describe, expect, test } from 'vitest';
import { computeTooltipPlacement, resolveTooltipContent } from '../src/renderer/tooltip';

const viewport = { width: 800, height: 600 };
const tooltip = { width: 100, height: 30 };

describe('computeTooltipPlacement', () => {
  test('places above and centered when there is room', () => {
    const result = computeTooltipPlacement({
      anchor: { left: 300, top: 200, width: 40, height: 20 },
      tooltip,
      viewport,
    });
    expect(result).toEqual({ left: 270, top: 162, side: 'top' });
  });

  test('flips below when there is no room above', () => {
    const result = computeTooltipPlacement({
      anchor: { left: 300, top: 10, width: 40, height: 20 },
      tooltip,
      viewport,
    });
    expect(result.side).toBe('bottom');
    expect(result.top).toBe(38);
  });

  test('clamps to the left edge', () => {
    const result = computeTooltipPlacement({
      anchor: { left: 0, top: 200, width: 20, height: 20 },
      tooltip,
      viewport,
    });
    expect(result.left).toBe(8);
  });

  test('clamps to the right edge', () => {
    const result = computeTooltipPlacement({
      anchor: { left: 790, top: 200, width: 10, height: 20 },
      tooltip,
      viewport,
    });
    expect(result.left).toBe(692);
  });
});

describe('resolveTooltipContent', () => {
  test('returns null without text', () => {
    expect(
      resolveTooltipContent(
        { tooltip: undefined, shortcut: 'new-session', shortcutText: undefined },
        true,
      ),
    ).toBeNull();
    expect(
      resolveTooltipContent({ tooltip: '  ', shortcut: undefined, shortcutText: undefined }, true),
    ).toBeNull();
  });

  test('formats a shortcut id per platform', () => {
    const source = { tooltip: 'Nova sessão', shortcut: 'new-session', shortcutText: undefined };
    expect(resolveTooltipContent(source, true)).toEqual({ text: 'Nova sessão', keys: '⌘N' });
    expect(resolveTooltipContent(source, false)).toEqual({ text: 'Nova sessão', keys: 'Ctrl+N' });
  });

  test('prefers literal shortcut text', () => {
    expect(
      resolveTooltipContent(
        { tooltip: 'Enviar mensagem', shortcut: undefined, shortcutText: 'Enter' },
        true,
      ),
    ).toEqual({ text: 'Enviar mensagem', keys: 'Enter' });
  });

  test('ignores unknown shortcut ids', () => {
    expect(
      resolveTooltipContent({ tooltip: 'X', shortcut: 'nope', shortcutText: undefined }, true),
    ).toEqual({ text: 'X', keys: null });
  });
});
