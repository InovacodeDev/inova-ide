import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import {
  formatForShortcut,
  formatsForAncestors,
  lineBreakCommand,
  type ComposerFormat,
} from './composer-format';
import { escapeHtml, markdownToHtml, normalizeLinkUrl, serializeMarkdown } from './rich-markdown';
import {
  flattenRichText,
  locateOffset,
  offsetOfPosition,
  plainTextOf,
  type TextPosition,
} from './rich-text-offsets';

export interface TextRangeEdit {
  start: number;
  end: number;
  text: string;
}

export interface RichComposerHandle {
  getText: () => string;
  getCaretOffset: () => number;
  replaceRange: (edit: TextRangeEdit) => void;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  insertText: (text: string) => void;
  focus: () => void;
  clear: () => void;
  isEmpty: () => boolean;
  format: (format: ComposerFormat) => void;
}

export interface RichComposerProps {
  ref?: Ref<RichComposerHandle>;
  isMac: boolean;
  readOnly: boolean;
  placeholder: string;
  onChange: (markdown: string) => void;
  onCaretChange: () => void;
  onActiveFormatsChange: (formats: ReadonlySet<ComposerFormat>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface LinkPromptState {
  url: string;
  hasLink: boolean;
  invalid: boolean;
}

const INLINE_COMMANDS: readonly { command: string; format: ComposerFormat }[] = [
  { command: 'bold', format: 'bold' },
  { command: 'italic', format: 'italic' },
  { command: 'underline', format: 'underline' },
  { command: 'strikeThrough', format: 'strike' },
];

const FORMAT_COMMAND: Readonly<Partial<Record<ComposerFormat, string>>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikeThrough',
  bullet: 'insertUnorderedList',
  ordered: 'insertOrderedList',
  divider: 'insertHorizontalRule',
};

const HEADING_TAG: Readonly<Partial<Record<ComposerFormat, string>>> = {
  heading1: 'h1',
  heading2: 'h2',
  heading3: 'h3',
};

const RESETTABLE_BLOCKS: ReadonlySet<string> = new Set(['blockquote', 'pre', 'h1', 'h2', 'h3']);

function selectionInside(root: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const { anchorNode, focusNode } = selection;
  if (anchorNode === null || focusNode === null) return null;
  return root.contains(anchorNode) && root.contains(focusNode) ? selection : null;
}

function ancestorElements(input: { node: Node | null; root: HTMLElement }): Element[] {
  const { root } = input;
  const found: Element[] = [];
  let current: Node | null = input.node;
  while (current !== null && current !== root) {
    if (current instanceof Element) found.push(current);
    current = current.parentNode;
  }
  return found;
}

function ancestorNames(input: { node: Node | null; root: HTMLElement }): string[] {
  return ancestorElements(input).map((element) => element.tagName.toLowerCase());
}

function closestElement(input: {
  node: Node | null;
  root: HTMLElement;
  tag: string;
}): HTMLElement | null {
  const match = ancestorElements(input).find(
    (element) => element.tagName.toLowerCase() === input.tag,
  );
  return match instanceof HTMLElement ? match : null;
}

function toDomPosition(position: TextPosition): { node: Node; offset: number } | null {
  return position.node instanceof Node ? { node: position.node, offset: position.offset } : null;
}

function placeCaretAtEnd(root: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCaret(input: { node: Node; offset: number }): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.setStart(input.node, input.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertPlainText(text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index > 0) document.execCommand('insertLineBreak');
    if (line !== '') document.execCommand('insertText', false, line);
  });
}

function configureEditing(): void {
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand('defaultParagraphSeparator', false, 'div');
}

function toggleInlineCode(root: HTMLElement): void {
  const selection = selectionInside(root);
  if (selection === null) return;
  const range = selection.getRangeAt(0);
  const code = closestElement({ node: range.commonAncestorContainer, root, tag: 'code' });
  if (code !== null && !range.collapsed) {
    const whole = document.createRange();
    whole.selectNode(code);
    selection.removeAllRanges();
    selection.addRange(whole);
    insertPlainText((code.textContent ?? '').replace(/​/g, ''));
    return;
  }
  if (code !== null) {
    const exit = document.createTextNode('​');
    code.after(exit);
    setCaret({ node: exit, offset: 1 });
    return;
  }
  if (range.collapsed) {
    const element = document.createElement('code');
    const marker = document.createTextNode('​');
    element.append(marker);
    range.insertNode(element);
    setCaret({ node: marker, offset: 1 });
    return;
  }
  const text = selection.toString().replace(/\s*\n+\s*/g, ' ');
  if (text.trim() === '') return;
  document.execCommand('insertHTML', false, `<code>${escapeHtml(text)}</code>`);
}

function toggleBlock(input: { root: HTMLElement; tag: string; active: boolean }): void {
  document.execCommand('formatBlock', false, input.active ? 'div' : input.tag);
}

function runBlockFormat(input: {
  root: HTMLElement;
  format: ComposerFormat;
  active: ReadonlySet<ComposerFormat>;
}): boolean {
  const { root, format, active } = input;
  const heading = HEADING_TAG[format];
  if (heading !== undefined) {
    toggleBlock({ root, tag: heading, active: active.has(format) });
    return true;
  }
  if (format === 'paragraph') {
    document.execCommand('formatBlock', false, 'div');
    return true;
  }
  if (format === 'codeblock') {
    toggleBlock({ root, tag: 'pre', active: active.has('codeblock') });
    return true;
  }
  if (format === 'quote') {
    if (active.has('quote')) document.execCommand('outdent');
    else document.execCommand('formatBlock', false, 'blockquote');
    return true;
  }
  return false;
}

function computeActiveFormats(root: HTMLElement): Set<ComposerFormat> {
  const selection = selectionInside(root);
  if (selection === null) return new Set();
  const formats = formatsForAncestors(ancestorNames({ node: selection.focusNode, root }));
  const ancestry = new Set(formats);
  const inHeading =
    ancestry.has('heading1') || ancestry.has('heading2') || ancestry.has('heading3');
  for (const { command, format } of INLINE_COMMANDS) {
    const trustAncestry =
      (format === 'bold' && inHeading) || (format === 'underline' && ancestry.has('link'));
    if (!trustAncestry && document.queryCommandState(command)) formats.add(format);
  }
  return formats;
}

function caretAtBlockStart(input: {
  root: HTMLElement;
  block: HTMLElement;
  range: Range;
}): boolean {
  const { block, range } = input;
  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString() === '' && probe.cloneContents().querySelector('br') === null;
}

function resetBlockAtCaretStart(root: HTMLElement): boolean {
  const selection = selectionInside(root);
  if (selection === null || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const elements = ancestorElements({ node: range.startContainer, root });
  const blockIndex = elements.findIndex((element) =>
    RESETTABLE_BLOCKS.has(element.tagName.toLowerCase()),
  );
  const block = elements[blockIndex];
  const insideList = elements
    .slice(0, Math.max(blockIndex, 0))
    .some((element) => element.tagName === 'LI');
  if (!(block instanceof HTMLElement) || insideList) return false;
  if (!caretAtBlockStart({ root, block, range })) return false;
  if (block.tagName === 'BLOCKQUOTE') document.execCommand('outdent');
  else document.execCommand('formatBlock', false, 'div');
  return true;
}

function isImeEvent(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function RichComposer({
  ref,
  isMac,
  readOnly,
  placeholder,
  onChange,
  onCaretChange,
  onActiveFormatsChange,
  onKeyDown,
}: RichComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const activeKeyRef = useRef('');
  const [linkPrompt, setLinkPrompt] = useState<LinkPromptState | null>(null);
  const latest = useRef({ onChange, onCaretChange, onActiveFormatsChange });

  useLayoutEffect(() => {
    latest.current = { onChange, onCaretChange, onActiveFormatsChange };
  });

  const refreshActive = () => {
    const root = editorRef.current;
    if (root === null) return;
    const formats = computeActiveFormats(root);
    const key = [...formats].sort().join(',');
    if (key === activeKeyRef.current) return;
    activeKeyRef.current = key;
    latest.current.onActiveFormatsChange(formats);
  };

  const afterEdit = () => {
    const root = editorRef.current;
    if (root === null) return;
    const markdown = serializeMarkdown(root);
    root.dataset.empty = String(markdown.trim() === '');
    latest.current.onChange(markdown);
    refreshActive();
    latest.current.onCaretChange();
  };

  useEffect(() => {
    const onSelectionChange = () => {
      const root = editorRef.current;
      if (root === null || selectionInside(root) === null) return;
      refreshActive();
      latest.current.onCaretChange();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  useEffect(() => {
    const root = editorRef.current;
    if (root !== null) root.dataset.empty = 'true';
    configureEditing();
  }, []);

  useEffect(() => {
    if (linkPrompt !== null && !linkPrompt.invalid) linkInputRef.current?.focus();
  }, [linkPrompt === null]);

  const openLinkPrompt = (root: HTMLElement) => {
    if (selectionInside(root) === null) {
      root.focus();
      placeCaretAtEnd(root);
    }
    const selection = selectionInside(root);
    if (selection === null) return;
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    const anchor = closestElement({ node: selection.focusNode, root, tag: 'a' });
    const url = anchor?.getAttribute('href') ?? '';
    setLinkPrompt({ url, hasLink: anchor !== null, invalid: false });
  };

  const closeLinkPrompt = () => {
    setLinkPrompt(null);
    editorRef.current?.focus();
  };

  const restoreSavedSelection = (root: HTMLElement): Selection | null => {
    const saved = savedRangeRef.current;
    root.focus();
    const selection = window.getSelection();
    if (saved === null || selection === null) return null;
    selection.removeAllRanges();
    selection.addRange(saved);
    return selection;
  };

  const applyLink = (url: string) => {
    const root = editorRef.current;
    if (root === null) return;
    const selection = restoreSavedSelection(root);
    if (selection === null) return;
    const anchor = closestElement({ node: selection.focusNode, root, tag: 'a' });
    if (url === '') {
      if (anchor !== null) {
        const range = document.createRange();
        range.selectNodeContents(anchor);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('unlink');
      }
    } else if (anchor !== null) {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('createLink', false, url);
    } else if (selection.isCollapsed) {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${escapeHtml(url).replace(/"/g, '&quot;')}">${escapeHtml(url)}</a>`,
      );
    } else {
      document.execCommand('createLink', false, url);
    }
    setLinkPrompt(null);
    afterEdit();
  };

  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    if (linkPrompt === null) return;
    const raw = linkPrompt.url.trim();
    if (raw === '') {
      if (linkPrompt.hasLink) applyLink('');
      else closeLinkPrompt();
      return;
    }
    const url = normalizeLinkUrl(raw);
    if (url === null) {
      setLinkPrompt({ ...linkPrompt, invalid: true });
      return;
    }
    applyLink(url);
  };

  const runFormat = (format: ComposerFormat) => {
    const root = editorRef.current;
    if (root === null || readOnly) return;
    if (format === 'link') {
      openLinkPrompt(root);
      return;
    }
    if (document.activeElement !== root) root.focus();
    if (selectionInside(root) === null) placeCaretAtEnd(root);
    const active = computeActiveFormats(root);
    const command = FORMAT_COMMAND[format];
    if (command !== undefined) document.execCommand(command);
    else if (format === 'code') toggleInlineCode(root);
    else runBlockFormat({ root, format, active });
    afterEdit();
  };

  const locateDom = (offset: number) => {
    const root = editorRef.current;
    if (root === null) return null;
    const flat = flattenRichText(root);
    return toDomPosition(locateOffset({ flat, root, offset }));
  };

  useImperativeHandle(
    ref,
    () => ({
      getText: () => {
        const root = editorRef.current;
        return root === null ? '' : plainTextOf(root);
      },
      getCaretOffset: () => {
        const root = editorRef.current;
        if (root === null) return 0;
        const flat = flattenRichText(root);
        const selection = selectionInside(root);
        if (selection === null || selection.focusNode === null) return flat.text.length;
        const position = { node: selection.focusNode, offset: selection.focusOffset };
        return offsetOfPosition({ flat, position }) ?? flat.text.length;
      },
      replaceRange: ({ start, end, text }) => {
        const root = editorRef.current;
        if (root === null) return;
        root.focus();
        const from = locateDom(start);
        const to = locateDom(end);
        const selection = window.getSelection();
        if (from === null || to === null || selection === null) return;
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
        if (text === '') document.execCommand('delete');
        else insertPlainText(text);
      },
      getMarkdown: () => {
        const root = editorRef.current;
        return root === null ? '' : serializeMarkdown(root);
      },
      setMarkdown: (markdown) => {
        const root = editorRef.current;
        if (root === null) return;
        root.innerHTML = markdownToHtml(markdown);
        root.focus();
        placeCaretAtEnd(root);
        afterEdit();
      },
      insertText: (text) => {
        const root = editorRef.current;
        if (root === null || text === '') return;
        root.focus();
        placeCaretAtEnd(root);
        insertPlainText(text);
      },
      focus: () => {
        const root = editorRef.current;
        if (root === null) return;
        const hadSelection = selectionInside(root) !== null;
        root.focus();
        if (!hadSelection) placeCaretAtEnd(root);
      },
      clear: () => {
        const root = editorRef.current;
        if (root === null) return;
        root.innerHTML = '';
        afterEdit();
      },
      isEmpty: () => {
        const root = editorRef.current;
        return root === null || serializeMarkdown(root).trim() === '';
      },
      format: runFormat,
    }),
    [readOnly],
  );

  const insertBreak = (root: HTMLElement) => {
    const selection = selectionInside(root);
    const names = ancestorNames({ node: selection?.focusNode ?? null, root });
    const command = lineBreakCommand(names);
    document.execCommand(command);
    if (command === 'insertParagraph' && names.some((name) => /^h[1-3]$/.test(name))) {
      document.execCommand('formatBlock', false, 'div');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = editorRef.current;
    if (root === null || readOnly) return;
    const format = formatForShortcut({ event, isMac });
    if (format !== null) {
      event.preventDefault();
      runFormat(format);
      return;
    }
    if (event.key === 'Enter' && event.shiftKey && !isImeEvent(event)) {
      event.preventDefault();
      insertBreak(root);
      return;
    }
    const plainBackspace =
      event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plainBackspace && resetBlockAtCaretStart(root)) {
      event.preventDefault();
      afterEdit();
      return;
    }
    onKeyDown(event);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (text !== '') insertPlainText(text);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  return (
    <div className="rich-composer">
      {linkPrompt !== null ? (
        <form className="rich-link-prompt" onSubmit={submitLink}>
          <input
            ref={linkInputRef}
            className="rich-link-input"
            type="text"
            inputMode="url"
            aria-label="Endereço do link"
            aria-invalid={linkPrompt.invalid}
            placeholder="https://exemplo.com"
            value={linkPrompt.url}
            onChange={(event) =>
              setLinkPrompt({ ...linkPrompt, url: event.target.value, invalid: false })
            }
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              closeLinkPrompt();
            }}
          />
          {linkPrompt.invalid ? (
            <span className="rich-link-error" role="alert">
              Use um endereço http, https ou mailto.
            </span>
          ) : null}
          <button type="submit" className="btn btn-sm btn-primary">
            Aplicar
          </button>
          <button type="button" className="btn btn-sm" onClick={closeLinkPrompt}>
            Cancelar
          </button>
        </form>
      ) : null}
      <div
        ref={editorRef}
        className="chat-input rich-input"
        role="textbox"
        aria-multiline="true"
        aria-label="Mensagem"
        aria-readonly={readOnly}
        contentEditable={!readOnly}
        data-placeholder={placeholder}
        data-empty="true"
        spellCheck
        onInput={afterEdit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onFocus={configureEditing}
      />
    </div>
  );
}
