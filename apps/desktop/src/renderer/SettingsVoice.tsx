import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_VOICE_POLISH_ENDPOINT,
  ELOQUENT_DEFAULT_MODEL,
  ELOQUENT_STANDALONE_COMMAND,
  isPolishEndpointUrl,
  resolveVoicePolishSettings,
} from '@inova/core/voice-settings';
import type { Settings, SettingsPatch, VoiceModelId, VoicePolishMode } from '@inova/core/types';
import type {
  VoiceDockerProgress,
  VoiceModelInfo,
  VoicePolishCheckResult,
  VoiceStatus,
} from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { formatMegabytes, parseCustomDictionary } from './dictation';
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

const POLISH_OPTIONS: { value: VoicePolishMode; labelKey: TranslationKey }[] = [
  { value: 'off', labelKey: 'settings.voice.polishMode.off' },
  { value: 'clean', labelKey: 'settings.voice.polishMode.clean' },
  { value: 'structured', labelKey: 'settings.voice.polishMode.structured' },
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
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [downloads, setDownloads] = useState<Downloads>({});
  const [pendingRemove, setPendingRemove] = useState<VoiceModelInfo | null>(null);
  const [checkingEndpoint, setCheckingEndpoint] = useState<string | null>(null);
  const [polishCheck, setPolishCheck] = useState<VoicePolishCheckResult | null>(null);
  const [installingDocker, setInstallingDocker] = useState(false);
  const [dockerProgress, setDockerProgress] = useState<VoiceDockerProgress | null>(null);
  const [dockerCopied, setDockerCopied] = useState(false);
  const endpointInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const loaded = await call(() => window.inova.getVoiceStatus());
    if (loaded) setStatus(loaded.value);
  }, [call]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

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

  useEffect(() => window.inova.onVoiceDockerProgress(setDockerProgress), []);

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
  const polish = resolveVoicePolishSettings(settings.voice);
  const detectedModels = polishCheck?.models ?? status?.polishModels ?? [];

  const checkingPolish = checkingEndpoint !== null;

  const checkPolishEndpoint = async () => {
    const raw = endpointInputRef.current?.value.trim() || DEFAULT_VOICE_POLISH_ENDPOINT;
    if (isPolishEndpointUrl(raw) && raw !== polish.endpoint) {
      onUpdate({ voice: { polishEndpoint: raw } });
    }
    setCheckingEndpoint(raw);
    try {
      const checked = await call(() => window.inova.checkVoicePolish({ endpoint: raw }));
      if (checked) {
        setPolishCheck(checked.value);
        setStatus((current) =>
          current === null ? current : { ...current, polishModels: checked.value.models },
        );
      }
    } finally {
      setCheckingEndpoint(null);
    }
  };

  const copyDockerCommand = async () => {
    try {
      await navigator.clipboard.writeText(ELOQUENT_STANDALONE_COMMAND);
      setDockerCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setDockerCopied(false), 2000);
    } catch {
      setDockerCopied(false);
    }
  };

  const installInDocker = async () => {
    const targetModel = polish.model.trim() || ELOQUENT_DEFAULT_MODEL;
    setInstallingDocker(true);
    setDockerProgress({ stage: 'checking', model: targetModel, percent: null });
    try {
      const result = await call(() => window.inova.setupVoiceDocker({ model: targetModel }));
      if (result) {
        setPolishCheck(result.value);
        if (polish.endpoint !== result.value.endpoint) {
          onUpdate({ voice: { polishEndpoint: result.value.endpoint } });
        }
        setStatus((current) =>
          current === null ? current : { ...current, polishModels: result.value.models },
        );
      } else {
        setDockerProgress(null);
      }
    } finally {
      setInstallingDocker(false);
    }
  };

  const dockerModelLabel = polish.model.trim() || ELOQUENT_DEFAULT_MODEL;
  const dockerDescription = (() => {
    if (dockerProgress === null) {
      return t('settings.voice.polishDockerDesc', { model: dockerModelLabel });
    }
    if (dockerProgress.stage === 'pulling') {
      const label =
        dockerProgress.percent !== null
          ? t('settings.voice.polishDockerStage.pullingPercent', {
              model: dockerProgress.model,
              percent: dockerProgress.percent,
            })
          : t('settings.voice.polishDockerStage.pulling', { model: dockerProgress.model });
      return (
        <>
          <span>{label}</span>
          {dockerProgress.percent !== null ? (
            <div
              className="usage-track voice-docker-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={dockerProgress.percent}
            >
              <div
                className="usage-fill usage-ok"
                style={{ width: `${dockerProgress.percent}%` }}
              />
            </div>
          ) : null}
        </>
      );
    }
    if (dockerProgress.stage === 'ready') {
      return (
        <span className="voice-endpoint-status-ok">
          {t('settings.voice.polishDockerStage.ready', { model: dockerProgress.model })}
        </span>
      );
    }
    return t(`settings.voice.polishDockerStage.${dockerProgress.stage}`);
  })();

  const endpointDescription = (() => {
    if (checkingEndpoint !== null) {
      return t('settings.voice.polishEndpointChecking', { endpoint: checkingEndpoint });
    }
    if (polishCheck !== null) {
      if (polishCheck.reachable && polishCheck.models.length > 0) {
        return (
          <span className="voice-endpoint-status-ok">
            {t('settings.voice.polishEndpointConnected', {
              endpoint: polishCheck.endpoint,
              models: polishCheck.models.join(', '),
            })}
          </span>
        );
      }
      if (polishCheck.reachable) {
        return t('settings.voice.polishEndpointEmpty', { endpoint: polishCheck.endpoint });
      }
      const time = new Date(polishCheck.checkedAt).toLocaleTimeString(locale);
      return (
        <span className="voice-endpoint-status-warn">
          {t('settings.voice.polishEndpointCheckedOffline', {
            endpoint: polishCheck.endpoint,
            time,
          })}
        </span>
      );
    }
    return detectedModels.length > 0
      ? t('settings.voice.polishEndpointStatus', { models: detectedModels.join(', ') })
      : t('settings.voice.polishEndpointOffline');
  })();

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
      <SettingGroup
        title={t('settings.voice.polishGroup')}
        description={t('settings.voice.polishDesc')}
      >
        <SettingRow
          title={t('settings.voice.polishModeTitle')}
          description={t('settings.voice.polishModeDesc')}
        >
          <Segmented
            name="dictation-polish-mode"
            label={t('settings.voice.polishModeTitle')}
            value={polish.mode}
            options={POLISH_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
            onChange={(polishMode) => onUpdate({ voice: { polishMode } })}
          />
        </SettingRow>
        <SettingRow
          htmlFor="voice-polish-model"
          title={t('settings.voice.polishModelTitle')}
          description={t('settings.voice.polishModelDesc')}
        >
          <input
            id="voice-polish-model"
            key={`model-${polish.model}`}
            type="text"
            className="field voice-control-input"
            defaultValue={polish.model}
            placeholder={t('settings.voice.polishModelPlaceholder')}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next !== polish.model) onUpdate({ voice: { polishModel: next } });
            }}
          />
        </SettingRow>
        <SettingRow
          htmlFor="voice-polish-endpoint"
          title={t('settings.voice.polishEndpointTitle')}
          description={endpointDescription}
        >
          <div className="voice-endpoint-control">
            <input
              ref={endpointInputRef}
              id="voice-polish-endpoint"
              key={`endpoint-${polish.endpoint}`}
              type="url"
              className="field"
              defaultValue={polish.endpoint}
              placeholder={DEFAULT_VOICE_POLISH_ENDPOINT}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim() || DEFAULT_VOICE_POLISH_ENDPOINT;
                if (isPolishEndpointUrl(next) && next !== polish.endpoint) {
                  onUpdate({ voice: { polishEndpoint: next } });
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={checkingPolish}
              aria-busy={checkingPolish}
              onClick={() => void checkPolishEndpoint()}
            >
              {checkingPolish
                ? t('settings.voice.polishCheckingBtn')
                : t('settings.voice.polishCheckBtn')}
            </button>
          </div>
        </SettingRow>
        <SettingRow title={t('settings.voice.polishDockerTitle')} description={dockerDescription}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={installingDocker}
            aria-busy={installingDocker}
            onClick={() => void installInDocker()}
          >
            {installingDocker
              ? t('settings.voice.polishDockerInstallingBtn')
              : t('settings.voice.polishDockerInstallBtn')}
          </button>
        </SettingRow>
        <SettingRow
          title={t('settings.voice.polishDockerManualTitle')}
          description={t('settings.voice.polishDockerManualDesc')}
        >
          <div className="voice-endpoint-control">
            <code className="voice-command-code mono" title={ELOQUENT_STANDALONE_COMMAND}>
              {ELOQUENT_STANDALONE_COMMAND}
            </code>
            <button type="button" className="btn" onClick={() => void copyDockerCommand()}>
              {dockerCopied
                ? t('settings.voice.polishDockerCopiedBtn')
                : t('settings.voice.polishDockerCopyBtn')}
            </button>
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup
        title={t('settings.voice.dictionaryGroup')}
        description={t('settings.voice.dictionaryDesc')}
      >
        <textarea
          key={`dict-${polish.customDictionary.join('\n')}`}
          className="field pinned-memory-textarea"
          rows={3}
          aria-label={t('settings.voice.dictionaryGroup')}
          defaultValue={polish.customDictionary.join(', ')}
          placeholder={t('settings.voice.dictionaryPlaceholder')}
          onBlur={(event) => {
            const parsed = parseCustomDictionary(event.currentTarget.value);
            if (parsed.join('\0') !== polish.customDictionary.join('\0')) {
              onUpdate({ voice: { customDictionary: parsed } });
            }
          }}
        />
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
