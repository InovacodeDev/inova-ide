import { useState } from 'react';
import type { InboxAttentionKind, InboxItem } from '@inova/core/types';
import { InboxIcon } from './icons';
import { filterInbox, unreadInboxCount, type InboxFilter } from './inbox-state';
import { ProviderBadge } from './ProviderBadge';
import { relativeTime } from './relative-time';

interface InboxViewProps {
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

export function InboxView({ items, onOpenItem, onClearRead }: InboxViewProps) {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const unread = unreadInboxCount(items);
  const visible = filterInbox(items, filter);
  const hasRead = items.some((item) => !item.unread);
  const now = new Date();

  return (
    <section className="inbox-section" aria-label="Caixa de entrada">
      <div className="inbox-header">
        <span className="inbox-title-wrap">
          <InboxIcon size={14} />
          <span className="section-label">Caixa de entrada</span>
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
          <div className="inbox-filters" role="tablist" aria-label="Filtro da caixa de entrada">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={filter === option.id}
                className={filter === option.id ? 'inbox-filter active' : 'inbox-filter'}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
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
                    className={item.unread ? 'inbox-item unread' : 'inbox-item'}
                    onClick={() => onOpenItem(item.sessionId)}
                  >
                    <div className="inbox-item-top">
                      <ProviderBadge provider={item.provider} size={16} />
                      <span className="inbox-item-title">{item.sessionTitle}</span>
                      <span className={`inbox-kind inbox-kind-${item.kind}`}>
                        {KIND_LABEL[item.kind]}
                      </span>
                    </div>
                    <div className="inbox-item-summary">{item.summary}</div>
                    <div className="inbox-item-meta">
                      <span>{item.projectName}</span>
                      <span>{relativeTime({ iso: item.at, now })}</span>
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
