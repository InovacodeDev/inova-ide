import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  filterCommandPaletteItems,
  groupCommandPaletteItems,
  moveCommandPaletteIndex,
  type CommandPaletteItem,
} from './command-palette-state';
import { CloseIcon, SearchIcon } from './icons';
import { formatShortcut } from './shortcuts';
import { useDialogFocus } from './useDialogFocus';

interface CommandPaletteModalProps {
  items: readonly CommandPaletteItem[];
  isMac: boolean;
  onSelect: (item: CommandPaletteItem) => void;
  onClose: () => void;
}

export function CommandPaletteModal({ items, isMac, onSelect, onClose }: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const filtered = useMemo(() => filterCommandPaletteItems(items, query), [items, query]);
  const groups = useMemo(() => groupCommandPaletteItems(filtered), [filtered]);
  const orderedItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const indexById = useMemo(
    () => new Map(orderedItems.map((item, index) => [item.id, index])),
    [orderedItems],
  );
  const activeIndex =
    orderedItems.length === 0 ? 0 : Math.min(selectedIndex, orderedItems.length - 1);
  const selectedItem = orderedItems[activeIndex] ?? null;

  useDialogFocus(cardRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, orderedItems.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(
        moveCommandPaletteIndex({ current: activeIndex, total: orderedItems.length, delta: 1 }),
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(
        moveCommandPaletteIndex({ current: activeIndex, total: orderedItems.length, delta: -1 }),
      );
      return;
    }
    if (event.key === 'Enter' && selectedItem) {
      event.preventDefault();
      onSelect(selectedItem);
    }
  };

  return (
    <div
      className="modal-backdrop command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="modal-card command-palette-card"
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-search">
          <span className="command-palette-search-icon" aria-hidden="true">
            <SearchIcon size={16} />
          </span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Buscar sessões, projetos, modelos, modos ou ações..."
            aria-label="Buscar comandos"
            aria-activedescendant={selectedItem ? `cmd-item-${selectedItem.id}` : undefined}
          />
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Fechar paleta"
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Comandos disponíveis">
          {groups.length === 0 ? (
            <div className="command-palette-empty">
              Nenhum comando encontrado para "{query.trim()}".
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="command-palette-group">
                <div className="command-palette-group-title">{group.category}</div>
                {group.items.map((item) => {
                  const rowIndex = indexById.get(item.id) ?? -1;
                  const selected = rowIndex === activeIndex;
                  const shortcutText = item.shortcutId
                    ? formatShortcut({ id: item.shortcutId, isMac })
                    : '';
                  return (
                    <button
                      key={item.id}
                      ref={selected ? activeRowRef : undefined}
                      id={`cmd-item-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? 'command-palette-row command-palette-row-active'
                          : 'command-palette-row'
                      }
                      onMouseEnter={() => {
                        if (rowIndex >= 0) setSelectedIndex(rowIndex);
                      }}
                      onClick={() => onSelect(item)}
                    >
                      <span className="command-palette-row-main">
                        <span className="command-palette-row-title">{item.title}</span>
                        {item.subtitle ? (
                          <span className="command-palette-row-subtitle">{item.subtitle}</span>
                        ) : null}
                      </span>
                      <span className="command-palette-row-meta">
                        {item.badge ? (
                          <span
                            className={
                              item.active
                                ? 'command-palette-badge command-palette-badge-active'
                                : 'command-palette-badge'
                            }
                          >
                            {item.badge}
                          </span>
                        ) : null}
                        {shortcutText ? (
                          <kbd className="command-palette-kbd">{shortcutText}</kbd>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>
            <kbd className="command-palette-kbd">↑↓</kbd> navegar
          </span>
          <span>
            <kbd className="command-palette-kbd">↵</kbd> executar
          </span>
          <span>
            <kbd className="command-palette-kbd">Esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
