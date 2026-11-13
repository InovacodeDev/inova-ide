import { useCallback, useEffect, useState } from 'react';
import type { Settings, SettingsPatch, VoiceModelId } from '@inova/core/types';
import type { VoiceModelInfo, VoiceStatus } from '../shared/api';
import { ConfirmModal } from './ConfirmModal';
import { formatMegabytes } from './dictation';
import { Segmented, SettingGroup, SettingRow } from './settings-controls';
import { downloadPercent, voiceModelState, type VoiceModelState } from './voice-model-state';
import type { WarningCall } from './useWarning';

interface SettingsVoiceProps {
  settings: Settings;
  onUpdate: (patch: SettingsPatch) => void;
  call: WarningCall;
}

const LANGUAGE_OPTIONS: { value: Settings['voice']['language']; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
];

const STATE_LABEL: Record<Exclude<VoiceModelState, 'downloading'>, string> = {
  'in-use': 'Em uso',
  installed: 'Instalado',
  missing: 'Não instalado',
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
  return (
    <li className="voice-model">
      <div className="voice-model-info">
        <span className="voice-model-name">{model.label}</span>
        <span className="voice-model-size">{formatMegabytes(model.bytes)}</span>
      </div>
      <span className={`voice-model-state voice-model-state-${state}`}>
        {state === 'downloading' ? `Baixando ${percent}%` : STATE_LABEL[state]}
      </span>
      <div className="voice-model-actions">
        {state === 'missing' ? (
          <button type="button" className="btn btn-sm" disabled={downloadBusy} onClick={onDownload}>
            Baixar
          </button>
        ) : null}
        {state === 'installed' ? (
          <button type="button" className="btn btn-sm" onClick={onUse}>
            Usar
          </button>
        ) : null}
        {state === 'installed' || state === 'in-use' ? (
          <button type="button" className="btn btn-sm" onClick={onRemove}>
            Remover
          </button>
        ) : null}
      </div>
      {state === 'downloading' ? (
        <div
          className="usage-track voice-model-progress"
          role="progressbar"
          aria-label={`Download do modelo ${model.label}`}
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
        title="Modelos de transcrição"
        description="A transcrição roda neste computador e o áudio não sai dele."
      >
        {status === null ? (
          <p className="setting-group-desc">Carregando…</p>
        ) : (
          <>
            <SettingRow
              title="whisper-cli"
              description={
                status.binary
                  ? 'Programa de transcrição encontrado nesta instalação.'
                  : 'Transcrição indisponível: whisper-cli não encontrado nesta instalação.'
              }
            >
              <span
                className={
                  status.binary ? 'voice-model-state voice-model-state-in-use' : 'voice-model-state'
                }
              >
                {status.binary ? 'Encontrado' : 'Não encontrado'}
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
      <SettingGroup title="Idioma do ditado">
        <SettingRow title="Idioma" description="Automático usa o idioma do sistema.">
          <Segmented
            name="dictation-language"
            label="Idioma do ditado"
            value={settings.voice.language}
            options={LANGUAGE_OPTIONS}
            onChange={(language) => onUpdate({ voice: { language } })}
          />
        </SettingRow>
      </SettingGroup>
      {pendingRemove ? (
        <ConfirmModal
          title="Remover modelo de voz"
          description={
            pendingRemove.id === activeId
              ? `Remover o modelo "${pendingRemove.label}"? Ele está em uso: o ditado vai pedir o download de novo na próxima gravação.`
              : `Remover o modelo "${pendingRemove.label}"? Será preciso baixar de novo para usá-lo.`
          }
          confirmLabel="Remover modelo"
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
