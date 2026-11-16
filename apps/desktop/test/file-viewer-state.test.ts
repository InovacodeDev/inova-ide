import { describe, expect, test } from 'vitest';
import {
  clampViewerWidth,
  fileViewerReducer,
  initialFileViewerState,
  VIEWER_DEFAULT_WIDTH,
  VIEWER_MIN_WIDTH,
  type FileViewerState,
} from '../src/renderer/file-viewer-state';

describe('fileViewerReducer', () => {
  test('openTab opens panel, creates tab, and sets activePath', () => {
    const state = fileViewerReducer(initialFileViewerState, {
      type: 'openTab',
      tab: {
        resolvedPath: '/workspace/src/app.ts',
        source: 'project',
        projectId: 'proj-1',
      },
    });

    expect(state.open).toBe(true);
    expect(state.activePath).toBe('/workspace/src/app.ts');
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toEqual({
      resolvedPath: '/workspace/src/app.ts',
      title: 'app.ts',
      source: 'project',
      projectId: 'proj-1',
      sessionId: undefined,
      revision: 1,
      line: null,
    });
  });

  test('openTab for same resolvedPath activates existing tab and increments revision without duplicating', () => {
    const first = fileViewerReducer(initialFileViewerState, {
      type: 'openTab',
      tab: {
        resolvedPath: '/workspace/src/app.ts',
        source: 'project',
      },
    });

    const second = fileViewerReducer(first, {
      type: 'openTab',
      tab: {
        resolvedPath: '/workspace/src/utils.ts',
        source: 'project',
      },
    });

    expect(second.tabs).toHaveLength(2);
    expect(second.activePath).toBe('/workspace/src/utils.ts');

    const reopened = fileViewerReducer(second, {
      type: 'openTab',
      tab: {
        resolvedPath: '/workspace/src/app.ts',
        source: 'project',
        line: 25,
      },
    });

    expect(reopened.tabs).toHaveLength(2);
    expect(reopened.activePath).toBe('/workspace/src/app.ts');
    expect(reopened.tabs[0]?.revision).toBe(2);
    expect(reopened.tabs[0]?.line).toBe(25);
    expect(reopened.open).toBe(true);
  });

  test('closeTab selects adjacent tab when closing active tab', () => {
    let state: FileViewerState = initialFileViewerState;
    for (const path of ['/a.ts', '/b.ts', '/c.ts']) {
      state = fileViewerReducer(state, {
        type: 'openTab',
        tab: { resolvedPath: path, source: 'project' },
      });
    }

    expect(state.activePath).toBe('/c.ts');

    const closedLast = fileViewerReducer(state, { type: 'closeTab', resolvedPath: '/c.ts' });
    expect(closedLast.tabs.map((tab) => tab.resolvedPath)).toEqual(['/a.ts', '/b.ts']);
    expect(closedLast.activePath).toBe('/b.ts');

    const selectedFirst = fileViewerReducer(closedLast, {
      type: 'selectTab',
      resolvedPath: '/a.ts',
    });
    const closedFirst = fileViewerReducer(selectedFirst, {
      type: 'closeTab',
      resolvedPath: '/a.ts',
    });
    expect(closedFirst.tabs.map((tab) => tab.resolvedPath)).toEqual(['/b.ts']);
    expect(closedFirst.activePath).toBe('/b.ts');
  });

  test('closing the last tab clears activePath and sets maximized to false', () => {
    const singleTab = fileViewerReducer(initialFileViewerState, {
      type: 'openTab',
      tab: { resolvedPath: '/only.ts', source: 'project' },
    });
    const maximized = fileViewerReducer(singleTab, { type: 'toggleMaximized' });
    expect(maximized.maximized).toBe(true);

    const closed = fileViewerReducer(maximized, { type: 'closeTab', resolvedPath: '/only.ts' });
    expect(closed.tabs).toEqual([]);
    expect(closed.activePath).toBeNull();
    expect(closed.maximized).toBe(false);
  });

  test('closing an inactive tab preserves the current activePath', () => {
    let state: FileViewerState = initialFileViewerState;
    for (const path of ['/a.ts', '/b.ts']) {
      state = fileViewerReducer(state, {
        type: 'openTab',
        tab: { resolvedPath: path, source: 'project' },
      });
    }
    expect(state.activePath).toBe('/b.ts');

    const closedInactive = fileViewerReducer(state, { type: 'closeTab', resolvedPath: '/a.ts' });
    expect(closedInactive.activePath).toBe('/b.ts');
    expect(closedInactive.tabs.map((tab) => tab.resolvedPath)).toEqual(['/b.ts']);
  });

  test('toggleMaximized opens panel when maximizing from closed state and restores cleanly', () => {
    expect(initialFileViewerState.open).toBe(false);
    expect(initialFileViewerState.maximized).toBe(false);

    const openedAndMaximized = fileViewerReducer(initialFileViewerState, {
      type: 'toggleMaximized',
    });
    expect(openedAndMaximized.open).toBe(true);
    expect(openedAndMaximized.maximized).toBe(true);

    const restored = fileViewerReducer(openedAndMaximized, { type: 'toggleMaximized' });
    expect(restored.open).toBe(true);
    expect(restored.maximized).toBe(false);
  });

  test('setWidthPx clamps to [320, Math.floor(containerWidth * 0.7)]', () => {
    const containerWidth = 1000;
    const belowMin = fileViewerReducer(initialFileViewerState, {
      type: 'setWidthPx',
      width: 200,
      containerWidth,
    });
    expect(belowMin.widthPx).toBe(VIEWER_MIN_WIDTH);

    const mid = fileViewerReducer(initialFileViewerState, {
      type: 'setWidthPx',
      width: 500,
      containerWidth,
    });
    expect(mid.widthPx).toBe(500);

    const aboveMax = fileViewerReducer(initialFileViewerState, {
      type: 'setWidthPx',
      width: 900,
      containerWidth,
    });
    expect(aboveMax.widthPx).toBe(700);
  });

  test('clampViewerWidth respects bounds across container sizes', () => {
    expect(clampViewerWidth({ width: 250, containerWidth: 1000 })).toBe(320);
    expect(clampViewerWidth({ width: 550, containerWidth: 1000 })).toBe(550);
    expect(clampViewerWidth({ width: 850, containerWidth: 1000 })).toBe(700);
    expect(clampViewerWidth({ width: 400, containerWidth: 400 })).toBe(320);
  });

  test('initial state constants match defaults', () => {
    expect(VIEWER_MIN_WIDTH).toBe(320);
    expect(VIEWER_DEFAULT_WIDTH).toBe(460);
    expect(initialFileViewerState.widthPx).toBe(VIEWER_DEFAULT_WIDTH);
    expect(initialFileViewerState.open).toBe(false);
    expect(initialFileViewerState.maximized).toBe(false);
    expect(initialFileViewerState.tabs).toEqual([]);
    expect(initialFileViewerState.activePath).toBeNull();
  });
});
