import type { Settings, VoiceModelId } from '@inova/core/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DICTATION_INTERIM_MS,
  DICTATION_MAX_MS,
  DICTATION_SAMPLE_RATE,
  encodePcm16,
  resolveDictationLanguage,
} from './dictation';

export type DictationPhase =
  'idle' | 'checking' | 'needs-model' | 'downloading' | 'recording' | 'transcribing';

export interface Dictation {
  phase: DictationPhase;
  interim: string;
  error: string | null;
  modelBytes: number;
  downloadPercent: number;
  getLevels: (target: Uint8Array<ArrayBuffer>) => boolean;
  toggle: () => void;
  confirmDownload: () => void;
  cancel: () => void;
  dismissError: () => void;
}

interface Capture {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  chunks: Float32Array[];
  interimTimer: ReturnType<typeof setInterval>;
  maxTimer: ReturnType<typeof setTimeout>;
}

const MIC_DENIED = 'Acesso ao microfone negado. Libere o microfone nas configurações do sistema.';
const MIC_FAILED = 'Não foi possível abrir o microfone.';
const BUFFER_SIZE = 4096;
export const ANALYSER_FFT_SIZE = 512;

export function useDictation(input: {
  hints: readonly string[];
  language?: Settings['voice']['language'];
  onText: (text: string) => void;
}): Dictation {
  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelBytes, setModelBytes] = useState(0);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const phaseRef = useRef<DictationPhase>('idle');
  const captureRef = useRef<Capture | null>(null);
  const interimBusyRef = useRef(false);
  const missingModelRef = useRef<VoiceModelId | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const currentPhase = useCallback((): DictationPhase => phaseRef.current, []);
  const setPhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const transcribe = useCallback((chunks: readonly Float32Array[], final: boolean) => {
    return window.inova.transcribeAudio({
      pcm: encodePcm16(chunks),
      final,
      language: resolveDictationLanguage({
        setting: inputRef.current.language,
        locale: navigator.language,
      }),
      hints: [...inputRef.current.hints],
    });
  }, []);

  const release = useCallback((): Float32Array[] => {
    const capture = captureRef.current;
    if (capture === null) return [];
    captureRef.current = null;
    clearInterval(capture.interimTimer);
    clearTimeout(capture.maxTimer);
    capture.analyser.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close();
    return capture.chunks;
  }, []);

  const finish = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    const chunks = release();
    setPhase('transcribing');
    const result = await transcribe(chunks, true);
    if (currentPhase() !== 'transcribing') return;
    setInterim('');
    setPhase('idle');
    if (result.ok) inputRef.current.onText(result.value.text);
    else setError(result.message);
  }, [currentPhase, release, setPhase, transcribe]);

  const record = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (cause: unknown) {
      const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
      setError(denied ? MIC_DENIED : MIC_FAILED);
      setPhase('idle');
      return;
    }
    const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
    const chunks: Float32Array[] = [];
    // NOTE: ScriptProcessorNode is deprecated but needs no worklet module, which the
    // file:// origin and the default-src 'self' policy make fragile to load.
    const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    source.connect(analyser);
    source.connect(processor);
    processor.connect(context.destination);

    const interimTimer = setInterval(() => {
      if (interimBusyRef.current || chunks.length === 0) return;
      interimBusyRef.current = true;
      void transcribe([...chunks], false)
        .then((result) => {
          if (result.ok && phaseRef.current === 'recording') setInterim(result.value.text);
        })
        .finally(() => {
          interimBusyRef.current = false;
        });
    }, DICTATION_INTERIM_MS);
    const maxTimer = setTimeout(() => void finish(), DICTATION_MAX_MS);
    captureRef.current = { stream, context, analyser, chunks, interimTimer, maxTimer };
    setInterim('');
    setPhase('recording');
  }, [finish, setPhase, transcribe]);

  const begin = useCallback(async () => {
    setError(null);
    setPhase('checking');
    const status = await window.inova.getVoiceStatus();
    if (!status.ok) {
      setError(status.message);
      setPhase('idle');
      return;
    }
    if (!status.value.binary) {
      setError('Transcrição indisponível: whisper-cli não encontrado nesta instalação.');
      setPhase('idle');
      return;
    }
    if (!status.value.model) {
      missingModelRef.current = status.value.modelId;
      setModelBytes(status.value.modelBytes);
      setPhase('needs-model');
      return;
    }
    await record();
  }, [record, setPhase]);

  const confirmDownload = useCallback(() => {
    const modelId = missingModelRef.current;
    if (phaseRef.current !== 'needs-model' || modelId === null) return;
    setDownloadPercent(0);
    setPhase('downloading');
    const unsubscribe = window.inova.onVoiceModelProgress((progress) => {
      if (progress.modelId !== modelId) return;
      setDownloadPercent(Math.floor((progress.receivedBytes / progress.totalBytes) * 100));
    });
    void window.inova
      .downloadVoiceModel({ modelId })
      .then(async (result) => {
        if (phaseRef.current !== 'downloading') return;
        if (result.ok) {
          await record();
          return;
        }
        setError(result.message);
        setPhase('idle');
      })
      .finally(unsubscribe);
  }, [record, setPhase]);

  const cancel = useCallback(() => {
    release();
    setInterim('');
    setPhase('idle');
  }, [release, setPhase]);

  const getLevels = useCallback((target: Uint8Array<ArrayBuffer>): boolean => {
    const capture = captureRef.current;
    if (capture === null) return false;
    capture.analyser.getByteTimeDomainData(target);
    return true;
  }, []);

  const toggle = useCallback(() => {
    if (phaseRef.current === 'recording') void finish();
    else if (phaseRef.current === 'idle') void begin();
  }, [begin, finish]);

  useEffect(() => () => void release(), [release]);

  return {
    phase,
    interim,
    error,
    modelBytes,
    downloadPercent,
    getLevels,
    toggle,
    confirmDownload,
    cancel,
    dismissError: () => setError(null),
  };
}
