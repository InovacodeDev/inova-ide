import { describe, expect, test } from 'vitest';
import type { UpdateInfo } from '../src/shared/api';
import {
  changelogTitle,
  isUpdateDismissed,
  shouldShowUpdateToast,
  shouldShowWhatsNew,
} from '../src/renderer/update-state';

const available: UpdateInfo = {
  current: '0.5.1',
  latest: '0.6.0',
  available: true,
  releaseUrl: 'https://github.com/InovacodeDev/inova-ide/releases/tag/v0.6.0',
};

describe('isUpdateDismissed', () => {
  test('matches only the same version', () => {
    expect(isUpdateDismissed({ dismissed: '0.6.0', latest: '0.6.0' })).toBe(true);
    expect(isUpdateDismissed({ dismissed: '0.5.9', latest: '0.6.0' })).toBe(false);
    expect(isUpdateDismissed({ dismissed: null, latest: '0.6.0' })).toBe(false);
    expect(isUpdateDismissed({ dismissed: null, latest: null })).toBe(false);
  });
});

describe('shouldShowUpdateToast', () => {
  test('shows for a new undismissed version', () => {
    expect(shouldShowUpdateToast({ info: available, dismissed: null })).toBe(true);
    expect(shouldShowUpdateToast({ info: available, dismissed: '0.5.9' })).toBe(true);
  });

  test('hides when dismissed, unavailable or unknown', () => {
    expect(shouldShowUpdateToast({ info: available, dismissed: '0.6.0' })).toBe(false);
    expect(
      shouldShowUpdateToast({ info: { ...available, available: false }, dismissed: null }),
    ).toBe(false);
    expect(shouldShowUpdateToast({ info: null, dismissed: null })).toBe(false);
  });
});

describe('shouldShowWhatsNew', () => {
  test('stays hidden on first install', () => {
    expect(shouldShowWhatsNew({ lastSeen: null, current: '0.5.1' })).toBe(false);
    expect(shouldShowWhatsNew({ lastSeen: '', current: '0.5.1' })).toBe(false);
  });

  test('shows only when the stored version differs', () => {
    expect(shouldShowWhatsNew({ lastSeen: '0.5.0', current: '0.5.1' })).toBe(true);
    expect(shouldShowWhatsNew({ lastSeen: '0.5.1', current: '0.5.1' })).toBe(false);
  });
});

describe('changelogTitle', () => {
  test('names the version only for the automatic whats-new view', () => {
    expect(changelogTitle({ whatsNew: true, version: '0.5.1' })).toBe('Novidades da versão 0.5.1');
    expect(changelogTitle({ whatsNew: false, version: '0.5.1' })).toBe('Novidades');
    expect(changelogTitle({ whatsNew: true, version: null })).toBe('Novidades');
  });
});
