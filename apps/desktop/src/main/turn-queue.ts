import { randomUUID } from 'node:crypto';
import type { QueuedTurn } from '@inova/core/types';

export interface TurnQueue {
  enqueue(input: {
    sessionId: string;
    accountId: string;
    prompt: string;
    extraDirs?: string[];
  }): QueuedTurn;
  requeueFront(entry: QueuedTurn): void;
  reassignSessionAccount(input: { sessionId: string; accountId: string }): boolean;
  cancelByTurnId(turnId: string): boolean;
  cancelBySession(sessionId: string): number;
  dequeueNext(
    accountId: string,
    input?: { skipSessions: ReadonlySet<string> },
  ): QueuedTurn | undefined;
  dequeueNextForSession(sessionId: string): QueuedTurn | undefined;
  list(accountId?: string): QueuedTurn[];
  forSession(sessionId: string): QueuedTurn[];
}

export function createTurnQueue(now: () => Date = () => new Date()): TurnQueue {
  const entries: QueuedTurn[] = [];

  return {
    enqueue(input) {
      const entry: QueuedTurn = {
        turnId: randomUUID(),
        sessionId: input.sessionId,
        accountId: input.accountId,
        prompt: input.prompt,
        enqueuedAt: now().toISOString(),
        ...(input.extraDirs && input.extraDirs.length > 0 ? { extraDirs: input.extraDirs } : {}),
      };
      entries.push(entry);
      return entry;
    },

    requeueFront(entry) {
      entries.unshift(entry);
    },

    reassignSessionAccount(input) {
      let changed = false;
      for (const entry of entries) {
        if (entry.sessionId === input.sessionId && entry.accountId !== input.accountId) {
          entry.accountId = input.accountId;
          changed = true;
        }
      }
      return changed;
    },

    cancelByTurnId(turnId) {
      const index = entries.findIndex((item) => item.turnId === turnId);
      if (index === -1) return false;
      entries.splice(index, 1);
      return true;
    },

    cancelBySession(sessionId) {
      let removed = 0;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (entries[i]?.sessionId === sessionId) {
          entries.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },

    dequeueNext(accountId, input) {
      const index = entries.findIndex(
        (item) => item.accountId === accountId && !input?.skipSessions.has(item.sessionId),
      );
      if (index === -1) return undefined;
      return entries.splice(index, 1)[0];
    },

    dequeueNextForSession(sessionId) {
      const index = entries.findIndex((item) => item.sessionId === sessionId);
      if (index === -1) return undefined;
      return entries.splice(index, 1)[0];
    },

    list(accountId) {
      if (accountId === undefined) return [...entries];
      return entries.filter((item) => item.accountId === accountId);
    },

    forSession(sessionId) {
      return entries.filter((item) => item.sessionId === sessionId);
    },
  };
}
