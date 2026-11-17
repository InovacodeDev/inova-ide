import { createHash } from 'node:crypto';

export type ApprovalMode = 'id' | 'key';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
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
