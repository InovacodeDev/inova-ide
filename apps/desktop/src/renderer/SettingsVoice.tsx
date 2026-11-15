import { useCallback, useEffect, useState } from 'react';
import type { Settings, SettingsPatch, VoiceModelId } from '@inova/core/types';
import type { VoiceModelInfo, VoiceStatus } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { formatMegabytes } from './dictation';
import { useI18n } from './I18nContext';
import type { TranslationKey } from './i18n';
import { Segmented, SettingGroup, SettingRow } from './settings-controls';
import { downloadPercent, voiceModelState, type VoiceModelState } from './voice-model-state';
import type { WarningCall } from './useWarning';

interface SettingsVoiceProps {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
  call: WarningCall;
}

const LANGUAGE_OPTIONS: { value: Settings['voice']['language']; labelKey: TranslationKey }[] = [
  { value: 'auto', labelKey: 'settings.voice.lang.auto' },
  { value: 'pt', labelKey: 'settings.voice.lang.pt' },
  { value: 'en', labelKey: 'settings.voice.lang.en' },
  { value: 'es', labelKey: 'settings.voice.lang.es' },
];

const STATE_KEY: Record<Exclude<VoiceModelState, 'downloading'>, TranslationKey> = {
  'in-use': 'settings.voice.state.inUse',
  installed: 'settings.voice.state.installed',
  missing: 'settings.voice.state.missing',
};

type Downloads = Partial<Record<VoiceModelId, number>>;

function ModelRow(props: {
  model: VoiceModelInfo;
  state: VoiceModelState;
  percent: number;
  downloadBusy: boolean;
  onDownload: () => void;
  onUse: () => void;
  onRemove: () => void;
}) {
  const { model, state, percent, downloadBusy, onDownload, onUse, onRemove } = props;
  const { t } = useI18n();
  return (
    <li className="voice-model">
      <div className="voice-model-info">
        <span className="voice-model-name">{model.label}</span>
        <span className="voice-model-size">{formatMegabytes(model.bytes)}</span>
      </div>
      <span className={`voice-model-state voice-model-state-${state}`}>
        {state === 'downloading'
          ? t('settings.voice.downloading', { percent })
          : t(STATE_KEY[state])}
      </span>
      <div className="voice-model-actions">
        {state === 'missing' ? (
          <button type="button" className="btn btn-sm" disabled={downloadBusy} onClick={onDownload}>
            {t('settings.voice.download')}
          </button>
        ) : null}
        {state === 'installed' ? (
          <button type="button" className="btn btn-sm" onClick={onUse}>
            {t('common.use')}
          </button>
        ) : null}
        {state === 'installed' || state === 'in-use' ? (
          <button type="button" className="btn btn-sm" onClick={onRemove}>
            {t('common.remove')}
          </button>
        ) : null}
      </div>
      {state === 'downloading' ? (
        <div
          className="usage-track voice-model-progress"
          role="progressbar"
          aria-label={t('settings.voice.downloadProgressAria', { label: model.label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="usage-fill usage-ok" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </li>
  );
}

export function VoiceSection({ settings, onUpdate, call }: SettingsVoiceProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [downloads, setDownloads] = useState<Downloads>({});
  const [pendingRemove, setPendingRemove] = useState<VoiceModelInfo | null>(null);

  const refresh = useCallback(async () => {
    const loaded = await call(() => window.inova.getVoiceStatus());
    if (loaded) setStatus(loaded.value);
  }, [call]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      window.inova.onVoiceModelProgress((progress) => {
        setDownloads((current) =>
          progress.modelId in current
            ? { ...current, [progress.modelId]: downloadPercent(progress) }
            : current,
        );
      }),
    [],
  );

  const download = async (modelId: VoiceModelId) => {
    setDownloads({ [modelId]: 0 });
    const result = await call(() => window.inova.downloadVoiceModel({ modelId }));
    setDownloads({});
    if (result) await refresh();
  };

  const remove = async (modelId: VoiceModelId) => {
    const result = await call(() => window.inova.deleteVoiceModel({ modelId }));
    if (result) setStatus(result.value);
  };

  const downloadBusy = Object.keys(downloads).length > 0;
  const activeId = settings.voice.modelId;

  return (
    <>
      <SettingGroup
        title={t('settings.voice.modelsTitle')}
        description={t('settings.voice.modelsDesc')}
      >
        {status === null ? (
          <p className="setting-group-desc">{t('common.loading')}</p>
        ) : (
          <>
            <SettingRow
              title="whisper-cli"
              description={
                status.binary
                  ? t('settings.voice.binaryFoundDesc')
                  : t('settings.voice.binaryMissingDesc')
              }
            >
              <span
                className={
                  status.binary ? 'voice-model-state voice-model-state-in-use' : 'voice-model-state'
                }
              >
                {status.binary ? t('settings.voice.found') : t('settings.voice.notFound')}
              </span>
            </SettingRow>
            <ul className="voice-models">
              {status.catalog.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  state={voiceModelState({
                    modelId: model.id,
                    activeId,
                    installed: status.installed,
                    downloading: model.id in downloads,
                  })}
                  percent={downloads[model.id] ?? 0}
                  downloadBusy={downloadBusy}
                  onDownload={() => void download(model.id)}
                  onUse={() => onUpdate({ voice: { modelId: model.id } })}
                  onRemove={() => setPendingRemove(model)}
                />
              ))}
            </ul>
          </>
        )}
      </SettingGroup>
      <SettingGroup title={t('settings.voice.dictationLangGroup')}>
        <SettingRow
          title={t('settings.voice.dictationLangTitle')}
          description={t('settings.voice.dictationLangDesc')}
        >
          <Segmented
            name="dictation-language"
            label={t('settings.voice.dictationLangGroup')}
            value={settings.voice.language}
            options={LANGUAGE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
            onChange={(language) => onUpdate({ voice: { language } })}
          />
        </SettingRow>
      </SettingGroup>
      {pendingRemove ? (
        <ConfirmModal
          title={t('settings.voice.removeTitle')}
          description={
            pendingRemove.id === activeId
              ? t('settings.voice.removeInUseDesc', { label: pendingRemove.label })
              : t('settings.voice.removeUnusedDesc', { label: pendingRemove.label })
          }
          confirmLabel={t('settings.voice.removeConfirm')}
          danger
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const target = pendingRemove;
            setPendingRemove(null);
            void remove(target.id);
          }}
        />
      ) : null}
    </>
  );
}
