export type ShortcutId =
  | 'open-settings'
  | 'new-session'
  | 'close-tab'
  | 'select-tab'
  | 'prev-tab'
  | 'next-tab'
  | 'open-inbox'
  | 'archive-session'
  | 'focus-composer'
  | 'toggle-dictation'
  | 'send-message'
  | 'submit-new-session'
  | 'dismiss';

export type ShortcutGroup = 'Geral' | 'Sessões' | 'Abas' | 'Composer';

export interface ShortcutDef {
  id: ShortcutId;
  group: ShortcutGroup;
  label: string;
  binding: string;
  global: boolean;
}

export interface ShortcutEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'open-settings',
    group: 'Geral',
    label: 'Abrir configurações',
    binding: 'mod+,',
    global: true,
  },
  {
    id: 'open-inbox',
    group: 'Geral',
    label: 'Abrir caixa de entrada',
    binding: 'mod+shift+u',
    global: true,
  },
  {
    id: 'dismiss',
    group: 'Geral',
    label: 'Fechar modal ou popover',
    binding: 'esc',
    global: false,
  },
  { id: 'new-session', group: 'Sessões', label: 'Nova sessão', binding: 'mod+n', global: true },
  {
    id: 'archive-session',
    group: 'Sessões',
    label: 'Arquivar sessão atual',
    binding: 'mod+shift+a',
    global: true,
  },
  {
    id: 'submit-new-session',
    group: 'Sessões',
    label: 'Criar sessão no formulário',
    binding: 'mod+enter',
    global: false,
  },
  { id: 'close-tab', group: 'Abas', label: 'Fechar aba', binding: 'mod+w', global: true },
  {
    id: 'select-tab',
    group: 'Abas',
    label: 'Ir para a aba 1 a 9',
    binding: 'mod+1…9',
    global: false,
  },
  { id: 'prev-tab', group: 'Abas', label: 'Aba anterior', binding: 'mod+shift+[', global: true },
  { id: 'next-tab', group: 'Abas', label: 'Próxima aba', binding: 'mod+shift+]', global: true },
  {
    id: 'focus-composer',
    group: 'Composer',
    label: 'Focar o composer',
    binding: 'mod+l',
    global: true,
  },
  {
    id: 'toggle-dictation',
    group: 'Composer',
    label: 'Iniciar ou parar ditado',
    binding: 'mod+shift+d',
    global: true,
  },
  {
    id: 'send-message',
    group: 'Composer',
    label: 'Enviar mensagem',
    binding: 'enter',
    global: false,
  },
];

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ',': 'Comma',
  '[': 'BracketLeft',
  ']': 'BracketRight',
};

const KEY_LABELS: Readonly<Record<string, string>> = { enter: 'Enter', esc: 'Esc' };

function hasModifiers(
  event: ShortcutEvent,
  input: { parts: readonly string[]; isMac: boolean },
): boolean {
  const mod = input.parts.includes('mod');
  const primary = input.isMac ? event.metaKey : event.ctrlKey;
  const secondary = input.isMac ? event.ctrlKey : event.metaKey;
  return (
    primary === mod &&
    !secondary &&
    event.shiftKey === input.parts.includes('shift') &&
    event.altKey === input.parts.includes('alt')
  );
}

export function matchShortcut(event: ShortcutEvent, binding: string, isMac: boolean): boolean {
  const parts = binding.split('+');
  const key = parts[parts.length - 1];
  if (key === undefined || !hasModifiers(event, { parts: parts.slice(0, -1), isMac })) return false;
  return event.key.toLowerCase() === key || event.code === PUNCTUATION_CODES[key];
}

export function matchTabIndex(event: ShortcutEvent, isMac: boolean): number | null {
  if (!hasModifiers(event, { parts: ['mod'], isMac })) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  return digit === undefined ? null : Number(digit) - 1;
}

export function findShortcut(event: ShortcutEvent, isMac: boolean): ShortcutId | null {
  const hit = SHORTCUTS.find((item) => item.global && matchShortcut(event, item.binding, isMac));
  return hit?.id ?? null;
}

export function formatBinding(binding: string, isMac: boolean): string {
  const labels = binding.split('+').map((part) => {
    if (part === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (part === 'shift') return isMac ? '⇧' : 'Shift';
    if (part === 'alt') return isMac ? '⌥' : 'Alt';
    return KEY_LABELS[part] ?? part.toUpperCase();
  });
  return labels.join(isMac ? '' : '+');
}
