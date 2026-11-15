import { useState, type Ref } from 'react';
import type { InboxAttentionKind, InboxItem } from '@inova/core/types';
import { useI18n } from './I18nContext';
import type { TranslationKey } from './i18n';
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

const KIND_KEY: Record<InboxAttentionKind, TranslationKey> = {
  completed: 'inbox.kind.completed',
  failed: 'inbox.kind.failed',
  'waiting-input': 'inbox.kind.waiting-input',
};

const FILTER_OPTIONS: { id: InboxFilter; labelKey: TranslationKey }[] = [
  { id: 'all', labelKey: 'inbox.filter.all' },
  { id: 'failed', labelKey: 'inbox.filter.failed' },
  { id: 'waiting', labelKey: 'inbox.filter.waiting' },
];

export function InboxView({ ref, items, onOpenItem, onClearRead }: InboxViewProps) {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const unread = unreadInboxCount(items);
  const counts = inboxFilterCounts(items);
  const visible = filterInbox(items, filter);
  const hasRead = items.some((item) => !item.unread);
  const now = new Date();

  return (
    <section ref={ref} className="inbox-section" aria-label={t('inbox.title')} tabIndex={-1}>
      <div className="inbox-header">
        <span className="inbox-title-wrap">
          <InboxIcon size={14} />
          <span className="inbox-heading">{t('inbox.title')}</span>
          {unread > 0 ? <span className="inbox-badge">{unread}</span> : null}
        </span>
        {hasRead ? (
          <button type="button" className="inbox-clear" onClick={onClearRead}>
            {t('inbox.clearRead')}
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <>
          <div
            className="inbox-filters"
            role="tablist"
            aria-label={t('inbox.filterLabel')}
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
                <span>{t(option.labelKey)}</span>
                {counts[option.id] > 0 ? (
                  <span className="inbox-filter-count">{counts[option.id]}</span>
                ) : null}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="inbox-empty">{t('inbox.emptyFilter')}</p>
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
                        <span className="inbox-unread-dot" aria-label={t('inbox.unreadLabel')} />
                      ) : null}
                      <ProviderBadge provider={item.provider} size={16} />
                      <span className="inbox-item-title">{item.sessionTitle}</span>
                      <span className={`inbox-kind inbox-kind-${item.kind}`}>
                        {t(KIND_KEY[item.kind])}
                      </span>
                    </div>
                    <div className="inbox-item-summary">{item.summary}</div>
                    <div className="inbox-item-meta">
                      <span className="inbox-item-project">{item.projectName}</span>
                      <span className="inbox-item-time">
                        {relativeTime({ iso: item.at, now, locale })}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="inbox-empty">{t('inbox.empty')}</p>
      )}
    </section>
  );
}
