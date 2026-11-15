import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility();
  }
  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function isTopmostDialog(container: HTMLElement): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter(
    isVisible,
  );
  const top = dialogs.at(-1);
  return top !== undefined && top.contains(container);
}

export function resolveDialogTabTarget<T>(input: {
  focusables: readonly T[];
  container: T;
  active: T | null;
  containsActive: boolean;
  shiftKey: boolean;
}): T | null {
  const { focusables, container, active, containsActive, shiftKey } = input;
  if (focusables.length === 0) return container;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) return null;
  if (!containsActive || active === null) return shiftKey ? last : first;
  if (shiftKey && (active === first || active === container)) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

export function useDialogFocus(cardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      card.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const current = cardRef.current;
      if (!current || !isTopmostDialog(current)) return;

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const nextTarget = resolveDialogTabTarget({
        focusables: getFocusableElements(current),
        container: current,
        active,
        containsActive: active !== null && current.contains(active),
        shiftKey: event.shiftKey,
      });
      if (!nextTarget) return;
      event.preventDefault();
      nextTarget.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, [cardRef]);
}
