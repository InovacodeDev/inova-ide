import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useI18n } from './I18nContext';
import { CloseIcon, SplitViewIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { queueCountLabel } from './queue-state';
import type { SessionStatus } from './session-status';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import { dropIndex, type Tab } from './tabs';

interface TabBarProps {
  tabs: Tab[];
  active: string | null;
  paneIds: string[];
  statusOf: (sessionId: string) => SessionStatus | undefined;
  queuedCountOf?: (sessionId: string) => number;
  onActivate(sessionId: string): void;
  onClose(tab: Tab): void;
  onSplit?(sessionId: string): void;
  onMove?(input: { sessionId: string; toIndex: number }): void;
}

interface DropMarker {
  targetId: string;
  after: boolean;
}

function isAfterMidpoint(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2;
}

export function TabBar(props: TabBarProps) {
  const { tabs, active, paneIds, statusOf, queuedCountOf, onActivate, onClose, onSplit, onMove } =
    props;
  const { locale, t } = useI18n();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const tabIds = tabs.map((tab) => tab.sessionId);
  const focusableId = tabIds.includes(active ?? '') ? active : (tabIds[0] ?? null);
  const endDrag = () => {
    setDraggedId(null);
    setDropMarker(null);
  };
  const dropOn = (targetId: string, after: boolean) => {
    if (draggedId === null || !onMove) return;
    const toIndex = dropIndex({ ids: tabIds, draggedId, targetId, after });
    if (toIndex !== null) onMove({ sessionId: draggedId, toIndex });
  };
  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label={t('tabs.openSessions')}
      onKeyDown={(event) =>
        handleHorizontalTabListKeyDown({
          event,
          ids: tabIds,
          activeId: focusableId,
          onSelect: onActivate,
        })
      }
    >
      {tabs.map((tab) => {
        const selected = tab.sessionId === active;
        const queuedCount = queuedCountOf?.(tab.sessionId) ?? 0;
        const inPane = paneIds.includes(tab.sessionId);
        const stateClass = selected ? ' tab-bar-tab-active' : inPane ? ' tab-bar-tab-pane' : '';
        const dragClass = draggedId === tab.sessionId ? ' tab-bar-tab-dragging' : '';
        const markerClass =
          dropMarker?.targetId === tab.sessionId && draggedId !== tab.sessionId
            ? dropMarker.after
              ? ' tab-bar-tab-drop-after'
              : ' tab-bar-tab-drop-before'
            : '';
        return (
          <div
            key={tab.sessionId}
            ref={selected ? activeTabRef : undefined}
            className={`tab-bar-tab${stateClass}${dragClass}${markerClass}`}
            draggable={Boolean(onMove)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', tab.title);
              setDraggedId(tab.sessionId);
            }}
            onDragOver={(event) => {
              if (draggedId === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const after = isAfterMidpoint(event);
              if (dropMarker?.targetId !== tab.sessionId || dropMarker.after !== after) {
                setDropMarker({ targetId: tab.sessionId, after });
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropOn(tab.sessionId, isAfterMidpoint(event));
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={tab.sessionId === focusableId ? 0 : -1}
              className="tab-bar-select"
              data-tooltip={tab.title}
              onClick={() => onActivate(tab.sessionId)}
            >
              <ProviderBadge provider={tab.provider} size={16} />
              <span className="tab-bar-title">{tab.title}</span>
              {statusOf(tab.sessionId) === 'running' && (
                <span className="tab-bar-running" role="img" aria-label={t('tabs.running')} />
              )}
              {queuedCount > 0 && (
                <span
                  className="tab-bar-queue"
                  role="img"
                  aria-label={queueCountLabel(queuedCount, locale)}
                >
                  {queuedCount}
                </span>
              )}
            </button>
            {onSplit && active !== null && !inPane && (
              <button
                type="button"
                className="icon-btn tab-bar-close tab-bar-split"
                aria-label={t('tabs.openToSide', { title: tab.title })}
                data-tooltip={t('tabs.openToSide', { title: tab.title })}
                onClick={() => onSplit(tab.sessionId)}
              >
                <SplitViewIcon size={12} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn tab-bar-close"
              aria-label={t('tabs.closeTab', { title: tab.title })}
              onClick={() => onClose(tab)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
