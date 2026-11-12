import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatItem, ChatState } from './chat-reducer';
import { Markdown } from './Markdown';
import './chat.css';

export interface ChatViewProps {
  state: ChatState;
  visible: boolean;
  title: string;
  readOnly?: boolean;
  onSend: (prompt: string) => void;
  onCancel: () => void;
}

const NEAR_BOTTOM_PX = 80;
const MAX_COMPOSER_PX = 200;

function firstLine(input: string): string {
  const line = input.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

function ToolCard({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  return (
    <details className={item.isError ? 'chat-tool chat-tool-error' : 'chat-tool'}>
      <summary className="chat-tool-summary">
        <span className="chat-tool-name">{item.name}</span>
        <span className="chat-tool-preview">{firstLine(item.input)}</span>
        {item.isError ? <span className="chat-tool-badge">negado/erro</span> : null}
        {item.output === null ? (
          <span className="chat-tool-badge chat-tool-pending">executando</span>
        ) : null}
      </summary>
      <div className="chat-tool-body">
        <div className="chat-tool-label">Entrada</div>
        <pre className="chat-tool-pre">{item.input}</pre>
        {item.output === null ? null : (
          <>
            <div className="chat-tool-label">Saída</div>
            <pre className="chat-tool-pre">{item.output}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function Message({ item }: { item: ChatItem }) {
  switch (item.type) {
    case 'user':
      return (
        <div className="chat-row chat-row-user">
          <div className="chat-user-bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-row chat-row-assistant">
          <Markdown text={item.text} streaming={item.streaming} />
          {item.streaming ? <span className="chat-caret" aria-hidden="true" /> : null}
        </div>
      );
    case 'tool':
      return (
        <div className="chat-row">
          <ToolCard item={item} />
        </div>
      );
    case 'error':
      return (
        <div className="chat-row">
          <div className="chat-error" role="alert">
            {item.message}
          </div>
        </div>
      );
  }
}

const ARCHIVED_HINT = 'Sessão arquivada — desarquive para continuar.';

export function ChatView({
  state,
  visible,
  title,
  readOnly = false,
  onSend,
  onCancel,
}: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const { items, running } = state;
  const last = items[items.length - 1];
  const thinking = running && !(last?.type === 'assistant' && last.streaming);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list !== null && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [items, thinking, visible]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [draft, visible]);

  const onScroll = () => {
    const list = listRef.current;
    if (list === null) return;
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  };

  const submit = () => {
    const prompt = draft.trim();
    if (prompt === '' || running || readOnly) return;
    stickRef.current = true;
    onSend(prompt);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="chat-view" style={visible ? undefined : { display: 'none' }}>
      <header className="chat-header">{title}</header>
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        <div className="chat-list-inner">
          {items.length === 0 && !running ? (
            <div className="chat-empty">Envie uma mensagem para começar</div>
          ) : null}
          {items.map((item) => (
            <Message key={item.id} item={item} />
          ))}
          {thinking ? (
            <div className="chat-row chat-thinking" aria-live="polite">
              pensando
              <span className="chat-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="chat-composer-wrap">
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={draft}
            placeholder={readOnly ? ARCHIVED_HINT : 'Escreva uma mensagem…'}
            disabled={readOnly}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <button type="button" className="chat-button chat-button-stop" onClick={onCancel}>
              Parar
            </button>
          ) : (
            <button
              type="button"
              className="chat-button"
              disabled={readOnly || draft.trim() === ''}
              onClick={submit}
            >
              Enviar
            </button>
          )}
        </div>
        {readOnly ? <p className="chat-readonly-hint">{ARCHIVED_HINT}</p> : null}
      </div>
    </section>
  );
}
