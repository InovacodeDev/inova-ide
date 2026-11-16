import {
  DEFAULT_VOICE_POLISH_ENDPOINT,
  ELOQUENT_CONTAINER_NAME,
  ELOQUENT_DEFAULT_MODEL,
  ELOQUENT_IMAGE,
  ELOQUENT_VOLUME_NAME,
} from '@inova/core/voice-settings';
import type { VoiceDockerProgress, VoicePolishCheckResult } from '../shared/api.js';
import { isRecord } from './validation.js';
import type { OllamaProbeResult } from './voice-polish.js';

export class VoiceDockerError extends Error {}

// REGEX: Ollama model reference (e.g. gemma3:4b, qwen2.5:3b, registry/ns/model:tag)
const VALID_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 300;
const PULL_TIMEOUT_MS = 30 * 60 * 1000;

export interface VoiceDockerDeps {
  findDocker: () => Promise<string | undefined>;
  runDocker: (input: { file: string; args: string[] }) => Promise<string>;
  probeEndpoint: (input: {
    endpoint: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  }) => Promise<OllamaProbeResult>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  onProgress: (progress: VoiceDockerProgress) => void;
  readyTimeoutMs?: number;
  readyPollMs?: number;
}

export function isValidOllamaModelName(value: unknown): value is string {
  return typeof value === 'string' && VALID_MODEL_NAME.test(value.trim());
}

export function hasInstalledModel(models: readonly string[], targetModel: string): boolean {
  const normalized = targetModel.trim().toLowerCase();
  const withLatest = normalized.includes(':') ? normalized : `${normalized}:latest`;
  return models.some((name) => {
    const lower = name.trim().toLowerCase();
    return lower === normalized || lower === withLatest;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOllama(input: {
  deps: VoiceDockerDeps;
  endpoint: string;
}): Promise<OllamaProbeResult> {
  const timeoutMs = input.deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const pollMs = input.deps.readyPollMs ?? READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let last: OllamaProbeResult = { reachable: false, models: [] };
  while (Date.now() < deadline) {
    last = await input.deps.probeEndpoint({
      endpoint: input.endpoint,
      fetch: input.deps.fetch,
    });
    if (last.reachable) return last;
    await delay(pollMs);
  }
  throw new VoiceDockerError(
    last.error
      ? `Container iniciou, mas o Ollama não respondeu (${last.error}).`
      : 'Container iniciou, mas o Ollama não respondeu a tempo.',
  );
}

async function pullOllamaModel(input: {
  deps: VoiceDockerDeps;
  endpoint: string;
  model: string;
}): Promise<void> {
  const response = await input.deps.fetch(`${input.endpoint}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
    body: JSON.stringify({ model: input.model, stream: true }),
  });
  if (!response.ok || response.body === null) {
    throw new VoiceDockerError(
      `Falha ao baixar o modelo "${input.model}" (HTTP ${response.status}).`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastPercent: number | null = null;

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (typeof parsed['error'] === 'string' && parsed['error'].trim() !== '') {
      throw new VoiceDockerError(`Erro ao baixar "${input.model}": ${parsed['error']}`);
    }
    const completed = parsed['completed'];
    const total = parsed['total'];
    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
      const percent = Math.min(100, Math.max(0, Math.floor((completed / total) * 100)));
      if (percent !== lastPercent) {
        lastPercent = percent;
        input.deps.onProgress({ stage: 'pulling', model: input.model, percent });
      }
    }
  }

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== '') handleLine(buffer);
}

export function createVoiceDockerSetup(deps: VoiceDockerDeps) {
  let activeSetup: Promise<VoicePolishCheckResult> | null = null;

  async function runSetup(model: string): Promise<VoicePolishCheckResult> {
    deps.onProgress({ stage: 'checking', model, percent: null });
    const docker = await deps.findDocker();
    if (docker === undefined) {
      throw new VoiceDockerError(
        'Docker não encontrado. Instale o Docker Desktop para ativar o servidor local.',
      );
    }
    try {
      await deps.runDocker({ file: docker, args: ['info', '--format', '{{.ServerVersion}}'] });
    } catch {
      throw new VoiceDockerError(
        'Docker encontrado, mas o daemon está parado. Abra o Docker Desktop e tente de novo.',
      );
    }

    deps.onProgress({ stage: 'starting', model, percent: null });
    let runningState: string | null = null;
    try {
      runningState = (
        await deps.runDocker({
          file: docker,
          args: ['inspect', '-f', '{{.State.Running}}', ELOQUENT_CONTAINER_NAME],
        })
      ).trim();
    } catch {
      runningState = null;
    }

    if (runningState === null) {
      await deps.runDocker({
        file: docker,
        args: [
          'run',
          '-d',
          '--name',
          ELOQUENT_CONTAINER_NAME,
          '--restart',
          'unless-stopped',
          '-p',
          '127.0.0.1:11434:11434',
          '-v',
          `${ELOQUENT_VOLUME_NAME}:/root/.ollama`,
          ELOQUENT_IMAGE,
        ],
      });
    } else if (runningState !== 'true') {
      await deps.runDocker({ file: docker, args: ['start', ELOQUENT_CONTAINER_NAME] });
    }

    deps.onProgress({ stage: 'waiting', model, percent: null });
    const endpoint = DEFAULT_VOICE_POLISH_ENDPOINT;
    let probe = await waitForOllama({ deps, endpoint });

    if (!hasInstalledModel(probe.models, model)) {
      deps.onProgress({ stage: 'pulling', model, percent: 0 });
      await pullOllamaModel({ deps, endpoint, model });
      probe = await waitForOllama({ deps, endpoint });
    }

    deps.onProgress({ stage: 'ready', model, percent: 100 });
    return {
      endpoint,
      reachable: probe.reachable,
      models: probe.models,
      checkedAt: new Date().toISOString(),
      ...(probe.error !== undefined ? { error: probe.error } : {}),
    };
  }

  return function setupDocker(input?: { model?: string }): Promise<VoicePolishCheckResult> {
    const candidate = input?.model?.trim();
    const targetModel = candidate && candidate !== '' ? candidate : ELOQUENT_DEFAULT_MODEL;
    if (!isValidOllamaModelName(targetModel)) {
      return Promise.reject(new VoiceDockerError('Nome de modelo inválido para o Ollama.'));
    }
    if (activeSetup === null) {
      activeSetup = runSetup(targetModel).finally(() => {
        activeSetup = null;
      });
    }
    return activeSetup;
  };
}
