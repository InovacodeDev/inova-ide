import { describe, expect, it } from 'vitest';
import { deepseekCapabilities } from './deepseek.js';
import type { CapabilityContext } from './types.js';

const ctx = {} as CapabilityContext;

describe('deepseekCapabilities', () => {
  it('lists no categories and no cost', async () => {
    expect(await deepseekCapabilities.list(ctx)).toEqual({ categories: [], cost: null });
  });

  it('has no launch args', () => {
    expect(deepseekCapabilities.launchArgs([{ kind: 'mcp', id: 'a' }])).toEqual([]);
  });

  it('rejects setEnabled', async () => {
    await expect(
      deepseekCapabilities.setEnabled({ ctx, ref: { kind: 'mcp', id: 'a' }, enabled: false }),
    ).rejects.toThrow('DeepSeek não expõe itens configuráveis.');
  });
});
