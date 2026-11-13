import {
  childrenOf,
  isContainerBlock,
  isElementNode,
  isLineBlock,
  isTextNode,
  nodeNameOf,
  type RichNode,
} from './rich-markdown';

export interface TextPosition {
  node: RichNode;
  offset: number;
}

interface Segment {
  kind: 'text' | 'break' | 'anchor' | 'gap';
  node: RichNode;
  parent: RichNode;
  index: number;
  start: number;
  length: number;
}

export interface FlatText {
  text: string;
  segments: Segment[];
  starts: Map<RichNode, number>;
  ends: Map<RichNode, number>;
}

interface WalkState {
  root: RichNode;
  text: string;
  started: boolean;
  pendingBreak: boolean;
  segments: Segment[];
  starts: Map<RichNode, number>;
  ends: Map<RichNode, number>;
}

function plainData(data: string): string {
  return data.replace(/[ ​]/g, ' ');
}

function pushSegment(state: WalkState, segment: Omit<Segment, 'start'>): void {
  state.segments.push({ ...segment, start: state.text.length });
}

function emitGap(state: WalkState, block: RichNode): void {
  pushSegment(state, { kind: 'gap', node: block, parent: block, index: 0, length: 1 });
  state.text += '\n';
  state.pendingBreak = false;
}

function flushPendingBreak(state: WalkState, owner: RichNode): void {
  if (state.pendingBreak) emitGap(state, owner);
}

function isPlaceholderBreak(input: { parent: RichNode; index: number; root: RichNode }): boolean {
  const { parent, index, root } = input;
  const blockParent = parent === root || isLineBlock(parent) || isContainerBlock(parent);
  return blockParent && index === childrenOf(parent).length - 1;
}

function visitText(
  child: RichNode,
  state: WalkState,
  position: { parent: RichNode; index: number },
) {
  const data = plainData(child.textContent ?? '');
  if (data === '') {
    state.starts.set(child, state.text.length);
    state.ends.set(child, state.text.length);
    return;
  }
  flushPendingBreak(state, child);
  state.starts.set(child, state.text.length);
  pushSegment(state, { kind: 'text', node: child, length: data.length, ...position });
  state.text += data;
  state.ends.set(child, state.text.length);
  state.started = true;
}

function visitBreak(
  child: RichNode,
  state: WalkState,
  position: { parent: RichNode; index: number },
) {
  state.starts.set(child, state.text.length);
  if (isPlaceholderBreak({ ...position, root: state.root })) {
    pushSegment(state, { kind: 'anchor', node: child, length: 0, ...position });
  } else {
    flushPendingBreak(state, position.parent);
    state.starts.set(child, state.text.length);
    pushSegment(state, { kind: 'break', node: child, length: 1, ...position });
    state.text += '\n';
    state.started = true;
  }
  state.ends.set(child, state.text.length);
}

function visitElement(child: RichNode, state: WalkState): void {
  if (isLineBlock(child)) {
    if (state.started) emitGap(state, child);
    state.started = true;
  } else if (isContainerBlock(child)) {
    state.pendingBreak = state.started;
  }
  state.starts.set(child, state.text.length);
  walkChildren(child, state);
  state.ends.set(child, state.text.length);
  if (isLineBlock(child) || isContainerBlock(child)) state.pendingBreak = true;
}

function walkChildren(parent: RichNode, state: WalkState): void {
  childrenOf(parent).forEach((child, index) => {
    if (isTextNode(child)) {
      visitText(child, state, { parent, index });
    } else if (!isElementNode(child)) {
      return;
    } else if (nodeNameOf(child) === 'br') {
      visitBreak(child, state, { parent, index });
    } else {
      visitElement(child, state);
    }
  });
}

export function flattenRichText(root: RichNode): FlatText {
  const state: WalkState = {
    root,
    text: '',
    started: false,
    pendingBreak: false,
    segments: [],
    starts: new Map(),
    ends: new Map(),
  };
  state.starts.set(root, 0);
  walkChildren(root, state);
  state.ends.set(root, state.text.length);
  return { text: state.text, segments: state.segments, starts: state.starts, ends: state.ends };
}

export function plainTextOf(root: RichNode): string {
  return flattenRichText(root).text;
}

export function locateOffset(input: {
  flat: FlatText;
  root: RichNode;
  offset: number;
}): TextPosition {
  const { flat, root } = input;
  const target = Math.max(0, Math.min(input.offset, flat.text.length));
  for (const segment of flat.segments) {
    if (segment.kind === 'text') {
      if (target <= segment.start + segment.length) {
        return { node: segment.node, offset: target - segment.start };
      }
    } else if (target <= segment.start) {
      return { node: segment.parent, offset: segment.index };
    }
  }
  return { node: root, offset: childrenOf(root).length };
}

export function offsetOfPosition(input: { flat: FlatText; position: TextPosition }): number | null {
  const { flat, position } = input;
  const { node, offset } = position;
  if (isTextNode(node)) {
    const start = flat.starts.get(node);
    if (start === undefined) return null;
    const length = plainData(node.textContent ?? '').length;
    return start + Math.max(0, Math.min(offset, length));
  }
  const kids = childrenOf(node);
  for (let index = offset; index < kids.length; index += 1) {
    const child = kids[index];
    const start = child === undefined ? undefined : flat.starts.get(child);
    if (start !== undefined) return start;
  }
  return flat.ends.get(node) ?? null;
}
