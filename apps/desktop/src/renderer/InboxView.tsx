import { useState, type Ref } from 'react';
import type { InboxAttentionKind, InboxItem } from '@inova/core/types';
import { InboxIcon } from './icons';
import { filterInbox, inboxFilterCounts, unreadInboxCount, type InboxFilter } from './inbox-state';
import { ProviderBadge } from './ProviderBadge';
import { relativeTime } from './relative-time';
import { handleHorizontalTabListKeyDown } from './tablist-nav';

interface InboxViewProps {
  ref?: Ref<HTMLElement>;
  items: readonly InboxItem[];
  onOpenItem: (sessionId: string) => void;
  onClearRead: () => void;
}

const KIND_LABEL: Record<InboxAttentionKind, string> = {
  completed: 'Concluída',
  failed: 'Falhou',
  'waiting-input': 'Aguardando',
};

const FILTER_OPTIONS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'failed', label: 'Erros' },
  { id: 'waiting', label: 'Aguardando' },
];

export function InboxView({ ref, items, onOpenItem, onClearRead }: InboxViewProps) {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const unread = unreadInboxCount(items);
  const counts = inboxFilterCounts(items);
  const visible = filterInbox(items, filter);
  const hasRead = items.some((item) => !item.unread);
  const now = new Date();

  return (
    <section ref={ref} className="inbox-section" aria-label="Caixa de entrada" tabIndex={-1}>
      <div className="inbox-header">
        <span className="inbox-title-wrap">
          <InboxIcon size={14} />
          <span className="inbox-heading">Caixa de entrada</span>
          {unread > 0 ? <span className="inbox-badge">{unread}</span> : null}
        </span>
        {hasRead ? (
          <button type="button" className="inbox-clear" onClick={onClearRead}>
            Limpar lidas
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <>
          <div
            className="inbox-filters"
            role="tablist"
            aria-label="Filtro da caixa de entrada"
            onKeyDown={(event) =>
              handleHorizontalTabListKeyDown({
                event,
                ids: FILTER_OPTIONS.map((option) => option.id),
                activeId: filter,
                onSelect: setFilter,
              })
            }
          >
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={filter === option.id}
                tabIndex={filter === option.id ? 0 : -1}
                className={filter === option.id ? 'inbox-filter active' : 'inbox-filter'}
                onClick={() => setFilter(option.id)}
              >
                <span>{option.label}</span>
                {counts[option.id] > 0 ? (
                  <span className="inbox-filter-count">{counts[option.id]}</span>
                ) : null}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="inbox-empty">Nenhum item neste filtro.</p>
          ) : (
            <ul className="inbox-list">
              {visible.map((item) => (
                <li key={item.sessionId}>
                  <button
                    type="button"
                    className={`inbox-item inbox-item-${item.kind}${item.unread ? ' unread' : ''}`}
                    onClick={() => onOpenItem(item.sessionId)}
                  >
                    <div className="inbox-item-top">
                      {item.unread ? (
                        <span className="inbox-unread-dot" aria-label="Não lida" />
                      ) : null}
                      <ProviderBadge provider={item.provider} size={16} />
                      <span className="inbox-item-title">{item.sessionTitle}</span>
                      <span className={`inbox-kind inbox-kind-${item.kind}`}>
                        {KIND_LABEL[item.kind]}
                      </span>
                    </div>
                    <div className="inbox-item-summary">{item.summary}</div>
                    <div className="inbox-item-meta">
                      <span className="inbox-item-project">{item.projectName}</span>
                      <span className="inbox-item-time">{relativeTime({ iso: item.at, now })}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="inbox-empty">Nenhuma notificação pendente.</p>
      )}
    </section>
  );
}
