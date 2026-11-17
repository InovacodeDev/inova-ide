import type { ReactElement } from 'react';
import type { ProfileSyncItem } from '../shared/api';
import { useI18n } from './I18nContext';
import { AlertIcon, CheckIcon, PlusIcon, RefreshIcon, ShieldAlertIcon, TrashIcon } from './icons';
import {
  approvalWarningKey,
  needsApproval,
  reasonText,
  statusPresentation,
  type StatusIcon,
} from './library-state';
import { ProviderBadge } from './ProviderBadge';
import './library.css';

const STATUS_ICONS: Record<StatusIcon, ReactElement> = {
  plus: <PlusIcon size={12} />,
  refresh: <RefreshIcon size={12} />,
  check: <CheckIcon size={12} />,
  alert: <AlertIcon size={12} />,
  shield: <ShieldAlertIcon size={12} />,
  trash: <TrashIcon size={12} />,
};

interface LibrarySyncItemProps {
  item: ProfileSyncItem;
  approved: boolean;
  onToggle: (id: string) => void;
}

function showsDiff(status: string): boolean {
  return status !== 'unchanged' && status !== 'incompatible';
}

export function LibrarySyncItem({ item, approved, onToggle }: LibrarySyncItemProps) {
  const { t } = useI18n();
  const presentation = statusPresentation(item.status);
  const askApproval = needsApproval(item);
  const warningKey = askApproval ? approvalWarningKey(item.status) : null;
  const reason = reasonText({ item, fallback: t('library.sync.noReason') });
  const meta = [item.scope, item.accountLabel].filter(Boolean).join(' · ');
  const empty = t('profileSync.emptyPreview');

  return (
    <li className="library-sync-item">
      <div className="library-sync-head">
        {askApproval ? (
          <label className="modal-check">
            <input
              type="checkbox"
              checked={approved}
              aria-label={`${t('library.sync.approve')}: ${item.targetPath}`}
              onChange={() => onToggle(item.id)}
            />
            <span>{t('library.sync.approve')}</span>
          </label>
        ) : null}
        <ProviderBadge provider={item.provider} size={16} />
        <span className="library-sync-target mono">{item.targetPath}</span>
        <span className={`library-status library-status-${presentation.tone}`}>
          {STATUS_ICONS[presentation.icon]}
          {t(presentation.labelKey, { status: item.status })}
        </span>
      </div>
      {meta !== '' ? <p className="library-sync-meta">{meta}</p> : null}
      {reason ? <p className="library-sync-reason">{reason}</p> : null}
      {warningKey ? <p className="library-warning">{t(warningKey)}</p> : null}
      {showsDiff(item.status) ? (
        <details className="library-sync-diff">
          <summary>{t('library.sync.diff')}</summary>
          <div className="library-sync-grid">
            <div>
              <span className="modal-field-label">{t('library.sync.before')}</span>
              <pre className="library-sync-pre mono">
                {item.maskedBefore === '' ? empty : item.maskedBefore}
              </pre>
            </div>
            <div>
              <span className="modal-field-label">{t('library.sync.after')}</span>
              <pre className="library-sync-pre mono">
                {item.maskedAfter === '' ? empty : item.maskedAfter}
              </pre>
            </div>
          </div>
        </details>
      ) : null}
    </li>
  );
}
