import type { Session } from '@inova/core/types';

export interface SessionNode {
  session: Session;
  children: SessionNode[];
}

export const SESSION_LIMIT = 5;

export function splitArchived(sessions: readonly Session[]): {
  active: Session[];
  archived: Session[];
} {
  return {
    active: sessions.filter((session) => session.archivedAt === null),
    archived: sessions.filter((session) => session.archivedAt !== null),
  };
}

const byRecency = (a: SessionNode, b: SessionNode): number =>
  b.session.updatedAt.localeCompare(a.session.updatedAt);

export function buildSessionTree(sessions: readonly Session[]): SessionNode[] {
  const nodes = new Map<string, SessionNode>(
    sessions.map((session) => [session.id, { session, children: [] }]),
  );
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.session.parentId === null ? undefined : nodes.get(node.session.parentId);
    (parent ? parent.children : roots).push(node);
  }
  for (const node of nodes.values()) node.children.sort(byRecency);
  return roots.sort(byRecency);
}

function containsSession(node: SessionNode, id: string): boolean {
  return node.session.id === id || node.children.some((child) => containsSession(child, id));
}

export function visibleRoots(input: {
  roots: SessionNode[];
  limit: number;
  expanded: boolean;
  activeSessionId: string | null;
}): { visible: SessionNode[]; hiddenCount: number } {
  const { roots, limit, expanded, activeSessionId } = input;
  if (expanded || roots.length <= limit) return { visible: roots, hiddenCount: 0 };
  const visible = roots.slice(0, limit);
  const active =
    activeSessionId === null
      ? undefined
      : roots.slice(limit).find((root) => containsSession(root, activeSessionId));
  if (active) visible.push(active);
  return { visible, hiddenCount: roots.length - visible.length };
}
