import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  clampMenuPosition,
  contextMenuAnchor,
  isKeyboardOrigin,
  nextMenuIndex,
  type Point,
} from './context-menu';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  label: string;
  items: ContextMenuItem[];
  anchor: Point;
  focusFirst: boolean;
  ignoreRef?: RefObject<HTMLElement | null>;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const { label, items, anchor, focusFirst, ignoreRef, returnFocusTo, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const position = clampMenuPosition({
    point: anchor,
    itemCount: items.length,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });

  useEffect(() => {
    if (focusFirst) {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
  }, [focusFirst]);

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      returnFocusTo?.focus();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [ignoreRef, onClose, returnFocusTo]);

  return (
    <div
      ref={menuRef}
      className="sidebar-menu"
      role="menu"
      aria-label={label}
      style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => {
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
        const next = nextMenuIndex({
          current: buttons.findIndex((button) => button === document.activeElement),
          count: buttons.length,
          key: event.key,
        });
        if (next === null) return;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={
            item.danger ? 'sidebar-menu-item sidebar-menu-item-danger' : 'sidebar-menu-item'
          }
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon !== undefined && (
            <span className="sidebar-menu-icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface ContextMenuState<T> {
  target: T;
  anchor: Point;
  fromKeyboard: boolean;
  opener: HTMLElement;
}

export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = (event: MouseEvent<HTMLElement>, target: T) => {
    event.preventDefault();
    event.stopPropagation();
    const fromKeyboard = isKeyboardOrigin(event);
    const focused = document.activeElement;
    const opener =
      fromKeyboard && focused instanceof HTMLElement && event.currentTarget.contains(focused)
        ? focused
        : event.currentTarget;
    setState({
      target,
      anchor: contextMenuAnchor({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: opener.getBoundingClientRect(),
      }),
      fromKeyboard,
      opener,
    });
  };
  return { state, open, close };
}
