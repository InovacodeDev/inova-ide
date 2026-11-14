import { CloseIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { queueCountLabel } from './queue-state';
import type { SessionStatus } from './session-status';
import type { Tab } from './tabs';

interface TabBarProps {
  tabs: Tab[];
  active: string | null;
  statusOf: (sessionId: string) => SessionStatus | undefined;
  queuedCountOf?: (sessionId: string) => number;
  onActivate(sessionId: string): void;
  onClose(tab: Tab): void;
}

export function TabBar(props: TabBarProps) {
  const { tabs, active, statusOf, queuedCountOf, onActivate, onClose } = props;
  return (
    <div className="tab-bar" role="tablist" aria-label="Sessões abertas">
      {tabs.map((tab) => {
        const selected = tab.sessionId === active;
        const queuedCount = queuedCountOf?.(tab.sessionId) ?? 0;
        return (
          <div
            key={tab.sessionId}
            className={`tab-bar-tab${selected ? ' tab-bar-tab-active' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className="tab-bar-select"
              data-tooltip={tab.title}
              onClick={() => onActivate(tab.sessionId)}
            >
              <ProviderBadge provider={tab.provider} size={16} />
              <span className="tab-bar-title">{tab.title}</span>
              {statusOf(tab.sessionId) === 'running' && (
                <span className="tab-bar-running" role="img" aria-label="Executando" />
              )}
              {queuedCount > 0 && (
                <span
                  className="tab-bar-queue"
                  role="img"
                  aria-label={queueCountLabel(queuedCount)}
                >
                  {queuedCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className="icon-btn tab-bar-close"
              aria-label={`Fechar ${tab.title}`}
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
