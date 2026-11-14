import { describe, expect, it } from 'vitest';
import { claudeCapabilities, normalizeMcpName } from './claude.js';
import type { CapabilityContext } from './types.js';

describe('normalizeMcpName', () => {
  it('replaces characters outside [A-Za-z0-9_-]', () => {
    expect(normalizeMcpName('claude.ai Gmail')).toBe('claude_ai_Gmail');
  });

  it('maps colliding names to the same value', () => {
    expect(normalizeMcpName('a.b')).toBe(normalizeMcpName('a b'));
  });
});

describe('claudeCapabilities.launchArgs', () => {
  it('returns no args when nothing is disabled', () => {
    expect(claudeCapabilities.launchArgs([])).toEqual([]);
  });

  it('builds the --settings json for each kind', () => {
    const args = claudeCapabilities.launchArgs([
      { kind: 'connector', id: 'claude.ai Gmail' },
      { kind: 'skill', id: 'dataviz' },
      { kind: 'plugin', id: 'superpowers@synced' },
    ]);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('--settings');
    expect(JSON.parse(args[1] ?? '')).toEqual({
      permissions: { deny: ['mcp__claude_ai_Gmail'] },
      skillOverrides: { dataviz: 'off' },
      enabledPlugins: { 'superpowers@synced': false },
    });
  });

  it('denies user MCP servers by normalized name', () => {
    const args = claudeCapabilities.launchArgs([{ kind: 'mcp', id: 'my.server' }]);
    expect(JSON.parse(args[1] ?? '')).toEqual({ permissions: { deny: ['mcp__my_server'] } });
  });

  it('uses disableClaudeAiConnectors for the connector wildcard', () => {
    const args = claudeCapabilities.launchArgs([
      { kind: 'connector', id: '*' },
      { kind: 'connector', id: 'claude.ai Gmail' },
      { kind: 'mcp', id: 'graft' },
    ]);
    expect(JSON.parse(args[1] ?? '')).toEqual({
      permissions: { deny: ['mcp__graft'] },
      disableClaudeAiConnectors: true,
    });
  });

  it('emits only disableClaudeAiConnectors when the wildcard is alone', () => {
    const args = claudeCapabilities.launchArgs([{ kind: 'connector', id: '*' }]);
    expect(JSON.parse(args[1] ?? '')).toEqual({ disableClaudeAiConnectors: true });
  });
});

describe('claudeCapabilities.setEnabled', () => {
  it('rejects because Claude only supports launch mode', async () => {
    await expect(
      claudeCapabilities.setEnabled({
        ctx: {} as CapabilityContext,
        ref: { kind: 'skill', id: 'dataviz' },
        enabled: false,
      }),
    ).rejects.toThrow('Claude usa só o modo launch.');
  });
});
