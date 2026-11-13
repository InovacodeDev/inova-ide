import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeTooltipPlacement,
  resolveTooltipContent,
  type TooltipContent,
  type TooltipPlacement,
} from './tooltip';

const SHOW_DELAY_MS = 400;
const TOOLTIP_ID = 'app-tooltip';

interface ActiveTooltip {
  target: HTMLElement;
  content: TooltipContent;
}

function findTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const target = node.closest<HTMLElement>('[data-tooltip]');
  return target;
}

function readContent(target: HTMLElement, isMac: boolean): TooltipContent | null {
  return resolveTooltipContent(
    {
      tooltip: target.dataset.tooltip,
      shortcut: target.dataset.shortcut,
      shortcutText: target.dataset.shortcutText,
    },
    isMac,
  );
}

function isKeyboardFocus(target: HTMLElement): boolean {
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function TooltipLayer({ isMac }: { isMac: boolean }) {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const hide = () => {
      clearTimer();
      if (current !== null) current.removeAttribute('aria-describedby');
      current = null;
      setActive(null);
      setPlacement(null);
    };
    const show = (target: HTMLElement) => {
      if (!target.isConnected) return;
      const content = readContent(target, isMac);
      if (content === null) return;
      if (current !== null && current !== target) current.removeAttribute('aria-describedby');
      current = target;
      target.setAttribute('aria-describedby', TOOLTIP_ID);
      setPlacement(null);
      setActive({ target, content });
    };
    const schedule = (target: HTMLElement, delay: number) => {
      clearTimer();
      if (delay === 0) show(target);
      else timer = window.setTimeout(() => show(target), delay);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = findTarget(event.target);
      if (target === null) return;
      if (target === current || target.contains(event.relatedTarget as Node | null)) return;
      if (current !== null) hide();
      schedule(target, SHOW_DELAY_MS);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = findTarget(event.target);
      if (target === null) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = findTarget(event.target);
      if (target === null || !isKeyboardFocus(target)) return;
      if (current !== null) hide();
      schedule(target, 0);
    };
    const onFocusOut = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [isMac]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (active === null || bubble === null) return;
    const rect = active.target.getBoundingClientRect();
    setPlacement(
      computeTooltipPlacement({
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        tooltip: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [active]);

  if (active === null) return null;
  return (
    <div
      ref={bubbleRef}
      id={TOOLTIP_ID}
      role="tooltip"
      className="tooltip"
      data-side={placement?.side ?? 'top'}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement === null ? 'hidden' : 'visible',
      }}
    >
      <span className="tooltip-text">{active.content.text}</span>
      {active.content.keys !== null ? (
        <kbd className="tooltip-kbd">{active.content.keys}</kbd>
      ) : null}
    </div>
  );
}
