import { Fragment, useEffect, useRef } from 'react';
import type { SlashSuggestion } from './composer-trigger';
import { FileIcon, TerminalIcon } from './icons';
import { PROVIDER_NAME } from './provider-meta';

export type ComposerPopupModel =
  | {
      kind: 'file';
      items: readonly string[];
      truncated: boolean;
      loading: boolean;
      activeIndex: number;
      onSelect: (filePath: string) => void;
    }
  | {
      kind: 'command';
      items: readonly SlashSuggestion[];
      nativeGroupLabel: string;
      loading: boolean;
      activeIndex: number;
      onSelect: (suggestion: SlashSuggestion) => void;
    };

const PROJECT_GROUP_LABEL = 'Comandos e skills do projeto';

function suggestionKey(suggestion: SlashSuggestion): string {
  if (suggestion.kind === 'native') return `native:${suggestion.command.name}`;
  const { source, kind, name } = suggestion.command;
  return `${source}:${kind}:${name}`;
}

export function ComposerPopup({ model }: { model: ComposerPopupModel }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [model.activeIndex, model.kind, model.items.length]);

  return (
    <div
      className="composer-popup"
      role="listbox"
      aria-label={model.kind === 'file' ? 'Arquivos do projeto' : 'Comandos'}
      ref={listRef}
    >
      {model.loading && model.items.length === 0 ? (
        <div className="composer-popup-empty">Carregando…</div>
      ) : model.items.length === 0 ? (
        <div className="composer-popup-empty">
          {model.kind === 'file'
            ? 'Nenhum arquivo encontrado.'
            : 'Nenhum comando ou skill encontrado.'}
        </div>
      ) : model.kind === 'file' ? (
        <>
          {model.items.map((filePath, index) => {
            const active = index === model.activeIndex;
            const slash = filePath.lastIndexOf('/');
            const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
            const dir = slash >= 0 ? filePath.slice(0, slash) : '';
            return (
              <button
                key={filePath}
                type="button"
                role="option"
                aria-selected={active}
                data-active={active ? 'true' : undefined}
                className={active ? 'composer-popup-item active' : 'composer-popup-item'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  model.onSelect(filePath);
                }}
              >
                <span className="composer-popup-icon">
                  <FileIcon size={14} />
                </span>
                <span className="composer-popup-title mono">{name}</span>
                {dir !== '' ? <span className="composer-popup-sub mono">{dir}</span> : null}
              </button>
            );
          })}
          {model.truncated ? (
            <div className="composer-popup-hint">Lista limitada para manter desempenho.</div>
          ) : null}
        </>
      ) : (
        model.items.map((suggestion, index) => {
          const active = index === model.activeIndex;
          const { command } = suggestion;
          const previous = model.items[index - 1];
          const heading =
            previous?.kind === suggestion.kind
              ? null
              : suggestion.kind === 'native'
                ? model.nativeGroupLabel
                : PROJECT_GROUP_LABEL;
          return (
            <Fragment key={suggestionKey(suggestion)}>
              {heading === null ? null : <div className="composer-popup-group">{heading}</div>}
              <button
                type="button"
                role="option"
                aria-selected={active}
                data-active={active ? 'true' : undefined}
                className={active ? 'composer-popup-item active' : 'composer-popup-item'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  model.onSelect(suggestion);
                }}
              >
                <span className="composer-popup-icon">
                  <TerminalIcon size={14} />
                </span>
                <span className="composer-popup-title mono">/{command.name}</span>
                {suggestion.kind === 'project' ? (
                  <span className="composer-popup-badge">
                    {PROVIDER_NAME[suggestion.command.source]}
                  </span>
                ) : null}
                {command.description !== '' ? (
                  <span className="composer-popup-sub">{command.description}</span>
                ) : null}
              </button>
            </Fragment>
          );
        })
      )}
    </div>
  );
}
