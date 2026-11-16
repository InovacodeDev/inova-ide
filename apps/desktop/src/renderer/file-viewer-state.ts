import type { FilePreviewSource } from '../shared/api';

export const VIEWER_MIN_WIDTH = 320;
export const VIEWER_DEFAULT_WIDTH = 460;

export interface FileViewerTab {
  readonly resolvedPath: string;
  readonly title: string;
  readonly source: FilePreviewSource;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly revision: number;
  readonly line?: number | null;
}

export interface FileViewerState {
  readonly open: boolean;
  readonly maximized: boolean;
  readonly widthPx: number;
  readonly tabs: readonly FileViewerTab[];
  readonly activePath: string | null;
}

export const initialFileViewerState: FileViewerState = {
  open: false,
  maximized: false,
  widthPx: VIEWER_DEFAULT_WIDTH,
  tabs: [],
  activePath: null,
};

export interface OpenTabPayload {
  readonly resolvedPath: string;
  readonly title?: string;
  readonly source: FilePreviewSource;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly line?: number | null;
}

export type FileViewerAction =
  | { readonly type: 'openTab'; readonly tab: OpenTabPayload }
  | ({ readonly type: 'openTab' } & OpenTabPayload)
  | { readonly type: 'closeTab'; readonly resolvedPath: string; readonly path?: string }
  | { readonly type: 'selectTab'; readonly resolvedPath: string; readonly path?: string }
  | { readonly type: 'toggleOpen' }
  | { readonly type: 'setOpen'; readonly open: boolean }
  | { readonly type: 'toggleMaximized' }
  | { readonly type: 'setMaximized'; readonly maximized: boolean }
  | { readonly type: 'setWidthPx'; readonly width: number; readonly containerWidth?: number }
  | { readonly type: 'clearTabs' }
  | { readonly type: 'reloadActiveTab' };

export function clampViewerWidth(input: { width: number; containerWidth: number }): number {
  const max = Math.max(VIEWER_MIN_WIDTH, Math.floor(input.containerWidth * 0.7));
  return Math.min(Math.max(input.width, VIEWER_MIN_WIDTH), max);
}

function defaultTabTitle(resolvedPath: string): string {
  const segments = resolvedPath.split(/[/\\]/).filter(Boolean);
  return segments.pop() ?? resolvedPath;
}

function extractOpenTabPayload(
  action: Extract<FileViewerAction, { type: 'openTab' }>,
): OpenTabPayload {
  if ('tab' in action) {
    return action.tab;
  }
  return action;
}

function handleOpenTab(
  state: FileViewerState,
  action: Extract<FileViewerAction, { type: 'openTab' }>,
): FileViewerState {
  const payload = extractOpenTabPayload(action);
  const { resolvedPath } = payload;
  if (!resolvedPath) return state;

  const existingIndex = state.tabs.findIndex((tab) => tab.resolvedPath === resolvedPath);
  if (existingIndex >= 0) {
    const existing = state.tabs[existingIndex];
    if (!existing) return state;
    const updated: FileViewerTab = {
      ...existing,
      title: payload.title ?? existing.title,
      source: payload.source ?? existing.source,
      projectId: payload.projectId ?? existing.projectId,
      sessionId: payload.sessionId ?? existing.sessionId,
      line: payload.line !== undefined ? payload.line : existing.line,
      revision: existing.revision + 1,
    };
    const nextTabs = state.tabs.map((tab, idx) => (idx === existingIndex ? updated : tab));
    return {
      ...state,
      open: true,
      activePath: resolvedPath,
      tabs: nextTabs,
    };
  }

  const newTab: FileViewerTab = {
    resolvedPath,
    title: payload.title ?? defaultTabTitle(resolvedPath),
    source: payload.source,
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    revision: 1,
    line: payload.line ?? null,
  };

  return {
    ...state,
    open: true,
    activePath: resolvedPath,
    tabs: [...state.tabs, newTab],
  };
}

function handleCloseTab(
  state: FileViewerState,
  action: Extract<FileViewerAction, { type: 'closeTab' }>,
): FileViewerState {
  const targetPath = action.resolvedPath ?? action.path;
  const targetIndex = state.tabs.findIndex((tab) => tab.resolvedPath === targetPath);
  if (targetIndex === -1) return state;

  const nextTabs = state.tabs.filter((_, idx) => idx !== targetIndex);
  if (nextTabs.length === 0) {
    return {
      ...state,
      tabs: [],
      activePath: null,
      maximized: false,
    };
  }

  if (state.activePath !== targetPath) {
    return {
      ...state,
      tabs: nextTabs,
    };
  }

  const nextIndex = Math.min(targetIndex, nextTabs.length - 1);
  const nextActive = nextTabs[nextIndex]?.resolvedPath ?? null;

  return {
    ...state,
    tabs: nextTabs,
    activePath: nextActive,
  };
}

function handleToggleMaximized(state: FileViewerState): FileViewerState {
  if (!state.open) {
    return {
      ...state,
      open: true,
      maximized: true,
    };
  }
  return {
    ...state,
    maximized: !state.maximized,
  };
}

export function fileViewerReducer(
  state: FileViewerState,
  action: FileViewerAction,
): FileViewerState {
  switch (action.type) {
    case 'openTab':
      return handleOpenTab(state, action);
    case 'closeTab':
      return handleCloseTab(state, action);
    case 'selectTab': {
      const targetPath = action.resolvedPath ?? action.path;
      if (!state.tabs.some((tab) => tab.resolvedPath === targetPath)) return state;
      return { ...state, activePath: targetPath, open: true };
    }
    case 'toggleOpen':
      return state.open ? { ...state, open: false, maximized: false } : { ...state, open: true };
    case 'setOpen':
      if (state.open === action.open) return state;
      return action.open ? { ...state, open: true } : { ...state, open: false, maximized: false };
    case 'toggleMaximized':
      return handleToggleMaximized(state);
    case 'setMaximized':
      if (action.maximized) {
        return { ...state, open: true, maximized: true };
      }
      return { ...state, maximized: false };
    case 'setWidthPx': {
      const clamped =
        action.containerWidth !== undefined
          ? clampViewerWidth({ width: action.width, containerWidth: action.containerWidth })
          : Math.max(VIEWER_MIN_WIDTH, action.width);
      return { ...state, widthPx: clamped };
    }
    case 'clearTabs':
      return { ...state, tabs: [], activePath: null, maximized: false };
    case 'reloadActiveTab': {
      if (!state.activePath) return state;
      const targetIndex = state.tabs.findIndex((tab) => tab.resolvedPath === state.activePath);
      if (targetIndex === -1) return state;
      const current = state.tabs[targetIndex];
      if (!current) return state;
      const reloaded: FileViewerTab = { ...current, revision: current.revision + 1 };
      return {
        ...state,
        tabs: state.tabs.map((tab, idx) => (idx === targetIndex ? reloaded : tab)),
      };
    }
  }
}
