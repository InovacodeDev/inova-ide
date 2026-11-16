import type { Settings, SupportedLocale, VoiceModelId, VoicePolishMode } from '@inova/core/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DICTATION_INTERIM_MS,
  DICTATION_MAX_MS,
  DICTATION_SAMPLE_RATE,
  appendDictation,
  encodePcm16,
  findPauseSplitSample,
  resolveDictationLanguage,
  sliceChunksRange,
  trimPcmSilence,
} from './dictation';
import { translate } from './i18n';

export type DictationPhase =
  'idle' | 'checking' | 'needs-model' | 'downloading' | 'recording' | 'transcribing';

export interface DictationPolishFallback {
  rawText: string;
  polishedText: string;
}

export interface Dictation {
  phase: DictationPhase;
  interim: string;
  error: string | null;
  polishFallback: DictationPolishFallback | null;
  modelBytes: number;
  downloadPercent: number;
  getLevels: (target: Uint8Array<ArrayBuffer>) => boolean;
  toggle: () => void;
  confirmDownload: () => void;
  cancel: () => void;
  dismissError: () => void;
  dismissPolishFallback: () => void;
}

interface Capture {
  id: number;
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  processor: AudioNode;
  chunks: Float32Array[];
  interimTimer: ReturnType<typeof setInterval>;
  maxTimer: ReturnType<typeof setTimeout>;
}

const BUFFER_SIZE = 4096;
const INTERIM_CLI_MS = 2_500;
export const ANALYSER_FFT_SIZE = 512;

async function attachCaptureNode(input: {
  context: AudioContext;
  source: AudioNode;
  onChunk: (samples: Float32Array) => void;
}): Promise<AudioNode> {
  const { context, source, onChunk } = input;
  try {
    if (typeof AudioWorkletNode !== 'undefined' && context.audioWorklet) {
      const workletUrl = new URL('./pcm-worklet.js', window.location.href).href;
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, 'pcm-capture-processor');
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (event.data instanceof Float32Array) onChunk(event.data);
      };
      source.connect(node);
      node.connect(context.destination);
      return node;
    }
  } catch {
    // NOTE: Fall back to ScriptProcessorNode when CSP or file:// blocks worklet loading.
  }
  const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
  processor.onaudioprocess = (event) => {
    onChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return processor;
}

export function useDictation(input: {
  hints: readonly string[];
  language?: Settings['voice']['language'];
  polishMode?: VoicePolishMode;
  locale?: SupportedLocale;
  onText: (text: string) => void;
}): Dictation {
  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [polishFallback, setPolishFallback] = useState<DictationPolishFallback | null>(null);
  const [modelBytes, setModelBytes] = useState(0);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const phaseRef = useRef<DictationPhase>('idle');
  const captureRef = useRef<Capture | null>(null);
  const captureIdRef = useRef(0);
  const interimBusyRef = useRef(false);
  const hasServerRef = useRef(false);
  const livePrefixRef = useRef('');
  const liveCursorRef = useRef(0);
  const missingModelRef = useRef<VoiceModelId | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const currentPhase = useCallback((): DictationPhase => phaseRef.current, []);
  const setPhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const transcribe = useCallback(
    (
      chunks: readonly Float32Array[],
      final: boolean,
    ): ReturnType<typeof window.inova.transcribeAudio> => {
      const audioChunks = final ? trimPcmSilence(chunks) : chunks;
      if (audioChunks.length === 0) {
        return Promise.resolve({
          ok: true as const,
          value: { text: '', rawText: '', polished: false },
        });
      }
      return window.inova.transcribeAudio({
        pcm: encodePcm16(audioChunks),
        final,
        language: resolveDictationLanguage({
          setting: inputRef.current.language,
          locale: navigator.language,
        }),
        hints: [...inputRef.current.hints],
        ...(final && inputRef.current.polishMode !== undefined
          ? { polishMode: inputRef.current.polishMode }
          : {}),
      });
    },
    [],
  );

  const release = useCallback((): Float32Array[] => {
    const capture = captureRef.current;
    if (capture === null) return [];
    captureRef.current = null;
    clearInterval(capture.interimTimer);
    clearTimeout(capture.maxTimer);
    capture.processor.disconnect();
    capture.analyser.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close();
    return capture.chunks;
  }, []);

  const finish = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    const chunks = release();
    livePrefixRef.current = '';
    liveCursorRef.current = 0;
    setPhase('transcribing');
    const result = await transcribe(chunks, true);
    if (currentPhase() !== 'transcribing') return;
    setInterim('');
    setPhase('idle');
    if (result.ok) {
      const inserted = result.value.text;
      const rawInserted = result.value.rawText ?? inserted;
      if (result.value.polished === true && rawInserted !== inserted) {
        setPolishFallback({ rawText: rawInserted, polishedText: inserted });
      }
      inputRef.current.onText(inserted);
    } else {
      setError(result.message);
    }
  }, [currentPhase, release, setPhase, transcribe]);

  const record = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (cause: unknown) {
      const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
      const locale = inputRef.current.locale ?? 'pt-BR';
      setError(translate(locale, denied ? 'dictation.micDenied' : 'dictation.micFailed'));
      setPhase('idle');
      return;
    }
    const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
    const chunks: Float32Array[] = [];
    const source = context.createMediaStreamSource(stream);
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    source.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(analyser);
    const processor = await attachCaptureNode({
      context,
      source: compressor,
      onChunk: (samples) => chunks.push(samples),
    });

    captureIdRef.current += 1;
    const captureId = captureIdRef.current;
    livePrefixRef.current = '';
    liveCursorRef.current = 0;

    const interimMs = hasServerRef.current ? DICTATION_INTERIM_MS : INTERIM_CLI_MS;
    const interimTimer = setInterval(() => {
      if (interimBusyRef.current || chunks.length === 0) return;
      const cursor = liveCursorRef.current;
      const splitAt = findPauseSplitSample(chunks, cursor);
      const previewChunks =
        splitAt !== null
          ? sliceChunksRange(chunks, cursor, splitAt)
          : sliceChunksRange(chunks, cursor);
      if (previewChunks.length === 0) return;
      interimBusyRef.current = true;
      void transcribe(previewChunks, false)
        .then((result) => {
          if (
            !result.ok ||
            phaseRef.current !== 'recording' ||
            captureRef.current?.id !== captureId
          ) {
            return;
          }
          if (splitAt !== null) {
            livePrefixRef.current = appendDictation(livePrefixRef.current, result.value.text);
            liveCursorRef.current = splitAt;
            setInterim(livePrefixRef.current);
            return;
          }
          setInterim(appendDictation(livePrefixRef.current, result.value.text));
        })
        .finally(() => {
          interimBusyRef.current = false;
        });
    }, interimMs);
    const maxTimer = setTimeout(() => void finish(), DICTATION_MAX_MS);
    captureRef.current = {
      id: captureId,
      stream,
      context,
      analyser,
      processor,
      chunks,
      interimTimer,
      maxTimer,
    };
    setInterim('');
    setPhase('recording');
  }, [finish, setPhase, transcribe]);

  const begin = useCallback(async () => {
    setError(null);
    setPolishFallback(null);
    setPhase('checking');
    const status = await window.inova.getVoiceStatus();
    if (!status.ok) {
      setError(status.message);
      setPhase('idle');
      return;
    }
    if (!status.value.binary) {
      setError(translate(inputRef.current.locale ?? 'pt-BR', 'dictation.whisperMissing'));
      setPhase('idle');
      return;
    }
    hasServerRef.current = status.value.server === true;
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
    livePrefixRef.current = '';
    liveCursorRef.current = 0;
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
    polishFallback,
    modelBytes,
    downloadPercent,
    getLevels,
    toggle,
    confirmDownload,
    cancel,
    dismissError: () => setError(null),
    dismissPolishFallback: () => setPolishFallback(null),
  };
}
