import { useEffect, useRef } from 'react';
import { openModalCount } from './modal-layers';
import { resolveShortcutCommand, type ShortcutCommand } from './shortcuts';

interface GlobalShortcutsInput {
  isMac: boolean;
  settingsOpen: boolean;
  run: (command: ShortcutCommand) => boolean;
}

function otherModalOpen(settingsOpen: boolean): boolean {
  return openModalCount() > (settingsOpen ? 1 : 0);
}

export function useGlobalShortcuts(input: GlobalShortcutsInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const { isMac, settingsOpen, run } = inputRef.current;
      const command = resolveShortcutCommand({
        event,
        isMac,
        settingsOpen,
        otherModalOpen: otherModalOpen(settingsOpen),
      });
      if (command !== null && run(command)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
