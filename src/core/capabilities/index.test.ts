import { describe, expect, it } from 'vitest';
import type { Account } from '../types.js';
import { capabilityAdapters, capabilityLaunchArgs } from './index.js';

const account: Account = {
  id: 'id1',
  provider: 'codex',
  label: 'work',
  homeDir: '/h/codex',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('capabilityLaunchArgs', () => {
  it('[RF-4] ignores invalid refs without throwing', () => {
    const invalid = [{ kind: 'bogus', id: 'x' }, null, 'mcp', { kind: 'mcp' }] as never;
    expect(capabilityLaunchArgs({ ...account, disabledCapabilities: invalid })).toEqual([]);
  });

  it('keeps valid refs next to invalid ones', () => {
    const mixed = [
      { kind: 'bogus', id: 'x' },
      { kind: 'mcp', id: 'y' },
    ] as never;
    expect(capabilityLaunchArgs({ ...account, disabledCapabilities: mixed })).toEqual([
      '-c',
      'mcp_servers.y.enabled=false',
    ]);
  });

  it('returns no args without a disabled list and covers every provider', () => {
    expect(capabilityLaunchArgs(account)).toEqual([]);
    expect(Object.keys(capabilityAdapters).sort()).toEqual([
      'claude',
      'codex',
      'deepseek',
      'gemini',
      'grok',
      'kimi',
      'opencode',
      'qwen',
    ]);
  });
});
