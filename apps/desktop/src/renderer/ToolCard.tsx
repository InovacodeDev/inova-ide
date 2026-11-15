import { useState } from 'react';
import type { ChatItem } from './chat-reducer';
import {
  CheckIcon,
  CopyIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ListTodoIcon,
  PencilIcon,
  TerminalIcon,
} from './icons';
import {
  presentTool,
  type DiffLine,
  type PresentedEditTool,
  type PresentedGenericTool,
  type PresentedLookupTool,
  type PresentedShellTool,
  type PresentedTodoTool,
} from './tool-presentation';

const DIFF_PREVIEW_LIMIT = 120;

function diffRowClass(type: DiffLine['type']): string {
  if (type === 'add') return 'chat-diff-line chat-diff-line-add';
  if (type === 'del') return 'chat-diff-line chat-diff-line-del';
  return 'chat-diff-line chat-diff-line-ctx';
}

function diffSign(type: DiffLine['type']): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

function ToolStatusBadges({
  isError,
  running,
  result,
}: {
  isError: boolean;
  running: boolean;
  result?: string | null;
}) {
  return (
    <>
      {result !== null && result !== undefined ? (
        <span className="chat-tool-status chat-tool-result">{result}</span>
      ) : null}
      {isError ? <span className="chat-tool-status chat-tool-failed">erro</span> : null}
      {running ? (
        <span className="chat-tool-status chat-tool-pending">
          <span className="dot pulse" aria-hidden="true" />
          executando
        </span>
      ) : null}
    </>
  );
}

function EditToolCard({
  item,
  presented,
  defaultOpen,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  presented: PresentedEditTool;
  defaultOpen: boolean;
}) {
  const [expandedAll, setExpandedAll] = useState(false);
  const totalLines = presented.diffLines.length;
  const visibleLines = expandedAll
    ? presented.diffLines
    : presented.diffLines.slice(0, DIFF_PREVIEW_LIMIT);
  const hiddenCount = totalLines - visibleLines.length;
  const label = presented.operation === 'write' ? 'Novo arquivo' : 'Edição';

  return (
    <details
      className={
        item.isError ? 'chat-tool chat-tool-edit chat-tool-error' : 'chat-tool chat-tool-edit'
      }
      open={defaultOpen}
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <PencilIcon size={16} />
        </span>
        <span className="chat-tool-name">{label}</span>
        <span className="chat-tool-preview">{presented.filePath}</span>
        {presented.addedLines > 0 ? (
          <span className="chat-tool-status chat-diff-stat-add">+{presented.addedLines}</span>
        ) : null}
        {presented.removedLines > 0 ? (
          <span className="chat-tool-status chat-diff-stat-del">-{presented.removedLines}</span>
        ) : null}
        <ToolStatusBadges isError={item.isError} running={item.output === null} />
      </summary>
      <div className="chat-tool-body">
        {totalLines > 0 ? (
          <div
            className="chat-diff-view"
            role="region"
            aria-label={`Diff de ${presented.filePath}`}
          >
            {visibleLines.map((line, idx) => (
              <div key={idx} className={diffRowClass(line.type)}>
                <span className="chat-diff-num">{line.newLine ?? line.oldLine ?? ''}</span>
                <span className="chat-diff-sign">{diffSign(line.type)}</span>
                <span className="chat-diff-code">{line.text === '' ? ' ' : line.text}</span>
              </div>
            ))}
            {hiddenCount > 0 ? (
              <button type="button" className="chat-diff-more" onClick={() => setExpandedAll(true)}>
                Mostrar todas as {totalLines} linhas (+{hiddenCount})
              </button>
            ) : null}
          </div>
        ) : (
          <pre className="chat-tool-pre">{item.input}</pre>
        )}
        {item.isError && item.output !== null ? (
          <pre className="chat-tool-pre">{item.output}</pre>
        ) : null}
      </div>
    </details>
  );
}

function ShellToolCard({
  item,
  presented,
  onCopyText,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  presented: PresentedShellTool;
  onCopyText: (text: string) => void;
}) {
  const result =
    item.output === null
      ? null
      : presented.lineCount > 0
        ? `${presented.lineCount} ${presented.lineCount === 1 ? 'linha' : 'linhas'}`
        : 'ok';
  const title = presented.command || item.name;
  return (
    <details
      className={
        item.isError ? 'chat-tool chat-tool-shell chat-tool-error' : 'chat-tool chat-tool-shell'
      }
      open={item.isError}
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <TerminalIcon size={16} />
        </span>
        <span className="chat-tool-name">Terminal</span>
        <span className="chat-tool-preview">$ {title}</span>
        <ToolStatusBadges isError={item.isError} running={item.output === null} result={result} />
      </summary>
      <div className="chat-tool-body chat-shell-body">
        <div className="chat-shell-head">
          <code className="chat-shell-cmd">$ {title}</code>
          <button
            type="button"
            className="chat-meta-btn"
            aria-label="Copiar comando"
            data-tooltip="Copiar comando"
            onClick={() => onCopyText(title)}
          >
            <CopyIcon size={12} />
          </button>
        </div>
        {presented.description ? (
          <div className="chat-shell-desc">{presented.description}</div>
        ) : null}
        {presented.output === null ? null : (
          <div className="chat-shell-output-wrap">
            <div className="chat-tool-label">Saída</div>
            <pre className="chat-shell-pre">
              {presented.output === '' ? '(sem saída)' : presented.output}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function LookupIcon({ category }: { category: PresentedLookupTool['category'] }) {
  if (category === 'files') return <FolderIcon size={15} />;
  if (category === 'read') return <FileTextIcon size={15} />;
  return <FileIcon size={15} />;
}

function LookupToolCard({
  item,
  presented,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  presented: PresentedLookupTool;
}) {
  return (
    <details
      className={
        item.isError ? 'chat-tool chat-tool-lookup chat-tool-error' : 'chat-tool chat-tool-lookup'
      }
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <LookupIcon category={presented.category} />
        </span>
        <span className="chat-tool-name">{presented.label}</span>
        <span className="chat-tool-preview">{presented.target || item.name}</span>
        <ToolStatusBadges
          isError={item.isError}
          running={item.output === null}
          result={presented.detail}
        />
      </summary>
      <div className="chat-tool-body">
        {presented.output === null ? (
          <pre className="chat-tool-pre">{item.input}</pre>
        ) : (
          <pre className="chat-tool-pre">{presented.output}</pre>
        )}
      </div>
    </details>
  );
}

function TodoToolCard({
  item,
  presented,
  defaultOpen,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  presented: PresentedTodoTool;
  defaultOpen: boolean;
}) {
  const summaryCount = `${presented.completedCount}/${presented.items.length}`;
  return (
    <details
      className={
        item.isError ? 'chat-tool chat-tool-todo chat-tool-error' : 'chat-tool chat-tool-todo'
      }
      open={defaultOpen}
    >
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <ListTodoIcon size={16} />
        </span>
        <span className="chat-tool-name">Plano de tarefas</span>
        <span className="chat-tool-preview">
          {presented.items.length === 1 ? '1 item' : `${presented.items.length} itens`}
        </span>
        <ToolStatusBadges
          isError={item.isError}
          running={item.output === null}
          result={summaryCount}
        />
      </summary>
      <div className="chat-tool-body">
        {presented.items.length > 0 ? (
          <ul className="chat-todo-list">
            {presented.items.map((todo, idx) => {
              const cls =
                todo.status === 'completed'
                  ? 'chat-todo-item chat-todo-done'
                  : todo.status === 'in_progress'
                    ? 'chat-todo-item chat-todo-active'
                    : 'chat-todo-item';
              return (
                <li key={idx} className={cls}>
                  <span className="chat-todo-dot" aria-hidden="true">
                    {todo.status === 'completed' ? (
                      <CheckIcon size={12} />
                    ) : todo.status === 'in_progress' ? (
                      <span className="dot pulse" />
                    ) : (
                      <span className="chat-todo-ring" />
                    )}
                  </span>
                  <span>{todo.content}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <pre className="chat-tool-pre">{item.input}</pre>
        )}
      </div>
    </details>
  );
}

function GenericToolCard({
  item,
  presented,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  presented: PresentedGenericTool;
}) {
  return (
    <details className={item.isError ? 'chat-tool chat-tool-error' : 'chat-tool'}>
      <summary className="chat-tool-summary">
        <span className="chat-tool-icon">
          <FileIcon size={16} />
        </span>
        <span className="chat-tool-name">{item.name}</span>
        <span className="chat-tool-preview">{presented.title}</span>
        <ToolStatusBadges
          isError={item.isError}
          running={item.output === null}
          result={presented.result}
        />
      </summary>
      <div className="chat-tool-body">
        <div className="chat-tool-label">Entrada</div>
        {presented.entries.length > 0 ? (
          <div className="chat-tool-kv">
            {presented.entries.map((entry) => (
              <div key={entry.key} className="chat-tool-kv-row">
                <span className="chat-tool-kv-key">{entry.key}</span>
                <span className="chat-tool-kv-val">{entry.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="chat-tool-pre">{presented.rawInput}</pre>
        )}
        {presented.output === null ? null : (
          <>
            <div className="chat-tool-label">Saída</div>
            <pre className="chat-tool-pre">{presented.output}</pre>
          </>
        )}
      </div>
    </details>
  );
}

export function ToolCard({
  item,
  defaultOpen = false,
  onCopyText,
}: {
  item: Extract<ChatItem, { type: 'tool' }>;
  defaultOpen?: boolean;
  onCopyText: (text: string) => void;
}) {
  const presented = presentTool(item);
  switch (presented.kind) {
    case 'edit':
      return <EditToolCard item={item} presented={presented} defaultOpen={defaultOpen} />;
    case 'shell':
      return <ShellToolCard item={item} presented={presented} onCopyText={onCopyText} />;
    case 'lookup':
      return <LookupToolCard item={item} presented={presented} />;
    case 'todo':
      return <TodoToolCard item={item} presented={presented} defaultOpen={defaultOpen} />;
    case 'generic':
      return <GenericToolCard item={item} presented={presented} />;
  }
}
