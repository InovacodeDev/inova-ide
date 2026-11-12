import { describe, expect, test } from 'vitest';
import { createPtyRouter } from '../src/renderer/pty-buffer';

describe('createPtyRouter', () => {
  test('chunks before attach are flushed in order on attach', () => {
    const router = createPtyRouter();
    router.data('a', '1');
    router.data('a', '2');
    const seen: string[] = [];
    router.attach('a', (chunk) => seen.push(chunk));
    expect(seen).toEqual(['1', '2']);
  });

  test('chunks after attach go straight to the writer', () => {
    const router = createPtyRouter();
    const seen: string[] = [];
    router.attach('a', (chunk) => seen.push(chunk));
    router.data('a', 'x');
    router.data('b', 'other');
    expect(seen).toEqual(['x']);
  });

  test('detach stops delivery and drops the buffer', () => {
    const router = createPtyRouter();
    const seen: string[] = [];
    const detach = router.attach('a', (chunk) => seen.push(chunk));
    detach();
    router.data('a', 'late');
    const again: string[] = [];
    router.attach('a', (chunk) => again.push(chunk));
    expect(seen).toEqual([]);
    expect(again).toEqual(['late']);
    detach();
    router.close('a');
    const third: string[] = [];
    router.attach('a', (chunk) => third.push(chunk));
    expect(third).toEqual([]);
  });

  test('an exit before open is reported when the tab opens', () => {
    const router = createPtyRouter();
    router.exit('a');
    expect(router.consumeExit('a')).toBe(true);
    expect(router.consumeExit('a')).toBe(false);
    expect(router.consumeExit('b')).toBe(false);
  });

  test('close drops buffer and exit; unknown sessions are a no-op', () => {
    const router = createPtyRouter();
    router.data('a', '1');
    router.exit('a');
    router.close('a');
    expect(router.consumeExit('a')).toBe(false);
    const seen: string[] = [];
    router.attach('a', (chunk) => seen.push(chunk));
    expect(seen).toEqual([]);
    expect(() => router.close('unknown')).not.toThrow();
  });
});
