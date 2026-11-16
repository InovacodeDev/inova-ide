import { useEffect, useRef } from 'react';
import { useI18n } from './I18nContext';
import { CloseIcon, SplitViewIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { queueCountLabel } from './queue-state';
import type { SessionStatus } from './session-status';
import { handleHorizontalTabListKeyDown } from './tablist-nav';
import type { Tab } from './tabs';

interface TabBarProps {
  tabs: Tab[];
  active: string | null;
  paneIds: string[];
  statusOf: (sessionId: string) => SessionStatus | undefined;
  queuedCountOf?: (sessionId: string) => number;
  onActivate(sessionId: string): void;
  onClose(tab: Tab): void;
  onSplit?(sessionId: string): void;
}

export function TabBar(props: TabBarProps) {
  const { tabs, active, paneIds, statusOf, queuedCountOf, onActivate, onClose, onSplit } = props;
  const { locale, t } = useI18n();
  const activeTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const tabIds = tabs.map((tab) => tab.sessionId);
  const focusableId = tabIds.includes(active ?? '') ? active : (tabIds[0] ?? null);
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
        const tabClass = selected ? ' tab-bar-tab-active' : inPane ? ' tab-bar-tab-pane' : '';
        return (
          <div
            key={tab.sessionId}
            ref={selected ? activeTabRef : undefined}
            className={`tab-bar-tab${tabClass}`}
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
