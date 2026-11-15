import type { UpdateInstallStage } from '../shared/api';
import { useI18n } from './I18nContext';
import { installStageView } from './update-state';
import './update.css';

interface UpdateProgressProps {
  latest: string | null;
  stage: UpdateInstallStage | null;
}

export function UpdateProgress({ latest, stage }: UpdateProgressProps) {
  const { locale, t } = useI18n();
  const { label, percent } = installStageView(stage, locale);
  const title =
    latest === null
      ? t('update.installingGeneric')
      : t('update.installingVersion', { version: latest });

  return (
    <div className="update-toast update-progress" role="status" aria-live="polite">
      <div className="update-toast-text">
        <span className="update-toast-title">{title}</span>
        <span className="update-toast-desc">{label}</span>
      </div>
      <div
        className="update-progress-track"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
      >
        <div className="update-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="update-progress-hint">{t('update.restartHint')}</span>
    </div>
  );
}
