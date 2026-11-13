import { applyFormat, diffEdit, type ComposerFormat } from './composer-format';
import { matchShortcut, SHORTCUTS, type ShortcutEvent, type ShortcutId } from './shortcuts';

const FORMAT_BY_SHORTCUT: Readonly<Partial<Record<ShortcutId, ComposerFormat>>> = {
  'format-bold': 'bold',
  'format-italic': 'italic',
  'format-underline': 'underline',
  'format-strike': 'strike',
  'format-code': 'code',
  'format-link': 'link',
};

export function formatForShortcut(input: {
  event: ShortcutEvent;
  isMac: boolean;
}): ComposerFormat | null {
  const hit = SHORTCUTS.find(
    (item) =>
      FORMAT_BY_SHORTCUT[item.id] !== undefined &&
      matchShortcut(input.event, item.binding, input.isMac),
  );
  return hit === undefined ? null : (FORMAT_BY_SHORTCUT[hit.id] ?? null);
}

function replaceThroughEditing(input: {
  textarea: HTMLTextAreaElement;
  start: number;
  end: number;
  text: string;
}): void {
  const { textarea, start, end, text } = input;
  textarea.focus();
  textarea.setSelectionRange(start, end);
  // NOTE: execCommand keeps the native undo stack; setRangeText is the fallback when it is refused
  const handled =
    text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
  if (handled) return;
  textarea.setRangeText(text, start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function formatTextarea(input: {
  textarea: HTMLTextAreaElement;
  format: ComposerFormat;
}): void {
  const { textarea, format } = input;
  const before = textarea.value;
  const result = applyFormat({
    value: before,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
    format,
  });
  const edit = diffEdit({ before, after: result.value });
  if (edit !== null) replaceThroughEditing({ textarea, ...edit });
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
}
