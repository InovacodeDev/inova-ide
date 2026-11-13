import { describe, expect, test } from 'vitest';
import {
  effectiveModeForSession,
  isRiskyBypassMode,
  optionByShortcutKey,
} from '../src/renderer/mode-picker-state';

describe('mode-picker-state', () => {
  test('effectiveModeForSession prioritizes session mode, then provider default, then catalog default', () => {
    expect(
      effectiveModeForSession({
        provider: 'claude',
        sessionMode: 'plan',
        defaultModes: { claude: 'auto' },
      }),
    ).toBe('plan');
    expect(
      effectiveModeForSession({
        provider: 'claude',
        sessionMode: null,
        defaultModes: { claude: 'auto' },
      }),
    ).toBe('auto');
    expect(
      effectiveModeForSession({
        provider: 'claude',
        sessionMode: null,
      }),
    ).toBe('accept-edits');
  });

  test('optionByShortcutKey maps numeric keys 1..N to provider options', () => {
    expect(optionByShortcutKey('claude', '1')?.id).toBe('auto');
    expect(optionByShortcutKey('claude', '4')?.id).toBe('plan');
    expect(optionByShortcutKey('claude', '9')).toBeNull();
    expect(optionByShortcutKey('claude', 'a')).toBeNull();
  });

  test('isRiskyBypassMode flags bypass when session is not in an isolated worktree', () => {
    expect(isRiskyBypassMode('bypass', false)).toBe(true);
    expect(isRiskyBypassMode('bypass', true)).toBe(false);
    expect(isRiskyBypassMode('accept-edits', false)).toBe(false);
  });
});
