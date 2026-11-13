import { useEffect, useRef } from 'react';
import type { ProjectCommandView } from '../shared/api';
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
      items: readonly ProjectCommandView[];
      loading: boolean;
      activeIndex: number;
      onSelect: (command: ProjectCommandView) => void;
    };

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
      aria-label={model.kind === 'file' ? 'Arquivos do projeto' : 'Comandos e skills do projeto'}
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
        model.items.map((command, index) => {
          const active = index === model.activeIndex;
          return (
            <button
              key={`${command.source}:${command.kind}:${command.name}`}
              type="button"
              role="option"
              aria-selected={active}
              data-active={active ? 'true' : undefined}
              className={active ? 'composer-popup-item active' : 'composer-popup-item'}
              onMouseDown={(event) => {
                event.preventDefault();
                model.onSelect(command);
              }}
            >
              <span className="composer-popup-icon">
                <TerminalIcon size={14} />
              </span>
              <span className="composer-popup-title mono">/{command.name}</span>
              <span className="composer-popup-badge">{PROVIDER_NAME[command.source]}</span>
              {command.description !== '' ? (
                <span className="composer-popup-sub">{command.description}</span>
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
