import { describe, expect, it } from 'vitest';
import { codexCapabilities } from './codex.js';

describe('codexCapabilities.launchArgs', () => {
  it('disables only MCP refs with -c pairs', () => {
    expect(
      codexCapabilities.launchArgs([
        { kind: 'mcp', id: 'my.server' },
        { kind: 'plugin', id: 'github@openai-curated-remote' },
        { kind: 'skill', id: 'docs' },
      ]),
    ).toEqual(['-c', 'mcp_servers."my.server".enabled=false']);
  });

  it('returns nothing when no MCP is disabled', () => {
    expect(codexCapabilities.launchArgs([])).toEqual([]);
  });
});
