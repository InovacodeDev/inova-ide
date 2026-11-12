import { describe, expect, test } from 'vitest';
import type { Session } from '@inova/core/types';
import { buildSessionTree, visibleRoots } from '../src/renderer/session-tree';

const session = (id: string, parentId: string | null, rank: number): Session => ({
  id,
  projectId: 'p',
  parentId,
  title: id,
  providerSessionId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(rank * 1000).toISOString(),
});

describe('buildSessionTree', () => {
  test('nests children and sorts every level by updatedAt desc', () => {
    const tree = buildSessionTree([
      session('a', null, 1),
      session('b', null, 5),
      session('a1', 'a', 2),
      session('a2', 'a', 9),
      session('a2x', 'a2', 3),
    ]);
    expect(tree.map((n) => n.session.id)).toEqual(['b', 'a']);
    const a = tree[1];
    expect(a?.children.map((n) => n.session.id)).toEqual(['a2', 'a1']);
    expect(a?.children[0]?.children.map((n) => n.session.id)).toEqual(['a2x']);
  });

  test('treats sessions with a missing parent as roots', () => {
    const tree = buildSessionTree([session('o', 'gone', 1), session('r', null, 2)]);
    expect(tree.map((n) => n.session.id)).toEqual(['r', 'o']);
  });
});

describe('visibleRoots', () => {
  const roots = buildSessionTree(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => session(id, null, 100 - i)),
  );
  const ids = (nodes: { session: Session }[]) => nodes.map((n) => n.session.id);

  test('cuts to the limit and reports hidden count', () => {
    const result = visibleRoots({ roots, limit: 5, expanded: false, activeSessionId: null });
    expect(ids(result.visible)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.hiddenCount).toBe(2);
  });

  test('shows everything when expanded', () => {
    const result = visibleRoots({ roots, limit: 5, expanded: true, activeSessionId: null });
    expect(result.visible).toHaveLength(7);
    expect(result.hiddenCount).toBe(0);
  });

  test('keeps the root of a hidden active session visible', () => {
    const result = visibleRoots({ roots, limit: 5, expanded: false, activeSessionId: 'g' });
    expect(ids(result.visible)).toEqual(['a', 'b', 'c', 'd', 'e', 'g']);
    expect(result.hiddenCount).toBe(1);
  });

  test('finds an active descendant inside a hidden root', () => {
    const nested = buildSessionTree([
      ...['a', 'b', 'c'].map((id, i) => session(id, null, 100 - i)),
      session('z', null, 1),
      session('z1', 'z', 1),
    ]);
    const result = visibleRoots({
      roots: nested,
      limit: 3,
      expanded: false,
      activeSessionId: 'z1',
    });
    expect(ids(result.visible)).toEqual(['a', 'b', 'c', 'z']);
    expect(result.hiddenCount).toBe(0);
  });
});
