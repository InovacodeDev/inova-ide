import { createHash } from 'node:crypto';

export type ApprovalMode = 'id' | 'key';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

export function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value, sortedKeys) ?? '').slice(0, 32);
}

export function approvalKey(input: {
  id: string;
  status: string;
  before: string;
  after: string;
}): string {
  const { id, status, before, after } = input;
  return sha256(JSON.stringify([id, status, sha256(before), sha256(after)])).slice(0, 32);
}

export function approvalToken(input: {
  mode: ApprovalMode | undefined;
  item: { id: string; approvalKey: string };
}): string {
  return input.mode === 'key' ? input.item.approvalKey : input.item.id;
}
