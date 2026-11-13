import { describe, expect, test } from 'vitest';
import { createTurnQueue } from '../src/main/turn-queue.js';

describe('turn-queue', () => {
  test('enqueues turns FIFO per account, cancels entries, and drains on availability', () => {
    const queue = createTurnQueue();
    const t1 = queue.enqueue({ sessionId: 's1', accountId: 'acc-1', prompt: 'Primeiro' });
    const t2 = queue.enqueue({ sessionId: 's2', accountId: 'acc-1', prompt: 'Segundo' });
    const t3 = queue.enqueue({ sessionId: 's3', accountId: 'acc-2', prompt: 'Outra conta' });

    expect(queue.list('acc-1').map((t) => t.turnId)).toEqual([t1.turnId, t2.turnId]);
    expect(queue.list().length).toBe(3);

    expect(queue.cancelByTurnId(t1.turnId)).toBe(true);
    expect(queue.list('acc-1').map((t) => t.turnId)).toEqual([t2.turnId]);

    const next = queue.dequeueNext('acc-1');
    expect(next?.turnId).toBe(t2.turnId);
    expect(queue.dequeueNext('acc-1')).toBeUndefined();
    expect(queue.dequeueNext('acc-2')?.turnId).toBe(t3.turnId);
  });

  test('cancelBySession removes only queued turns for that session', () => {
    const queue = createTurnQueue();
    queue.enqueue({ sessionId: 's1', accountId: 'acc-1', prompt: 'A' });
    queue.enqueue({ sessionId: 's2', accountId: 'acc-1', prompt: 'B' });

    const removed = queue.cancelBySession('s1');
    expect(removed).toBe(1);
    expect(queue.list('acc-1').map((item) => item.sessionId)).toEqual(['s2']);
  });
});
