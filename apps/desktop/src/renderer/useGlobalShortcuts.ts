import { useEffect, useRef } from 'react';
import { openModalCount } from './modal-layers';
import { resolveShortcutCommand, type ShortcutCommand } from './shortcuts';

interface GlobalShortcutsInput {
  isMac: boolean;
  settingsOpen: boolean;
  commandPaletteOpen?: boolean;
  run: (command: ShortcutCommand) => boolean;
}

function otherModalOpen(input: { settingsOpen: boolean; commandPaletteOpen: boolean }): boolean {
  const allowed = (input.settingsOpen ? 1 : 0) + (input.commandPaletteOpen ? 1 : 0);
  return openModalCount() > allowed;
}

export function useGlobalShortcuts(input: GlobalShortcutsInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const { isMac, settingsOpen, commandPaletteOpen = false, run } = inputRef.current;
      const command = resolveShortcutCommand({
        event,
        isMac,
        settingsOpen,
        commandPaletteOpen,
        otherModalOpen: otherModalOpen({ settingsOpen, commandPaletteOpen }),
      });
      if (command !== null && run(command)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
