import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export interface WhisperServerRequest {
  wav: Buffer;
  language: string;
  prompt: string;
  signal: AbortSignal;
}

export interface WhisperServerHandle {
  modelPath: string;
  transcribe(request: WhisperServerRequest): Promise<string>;
  stop(): Promise<void>;
}

const STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 50;
const KILL_GRACE_MS = 2_000;

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Falha ao alocar porta local para o whisper-server.')));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(input: { url: string; exited: () => number | null }): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const code = input.exited();
    if (code !== null) {
      throw new Error(`whisper-server encerrou na inicialização (código ${code}).`);
    }
    try {
      const response = await fetch(input.url, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status < 500) return;
    } catch {
      await delay(HEALTH_POLL_MS);
      continue;
    }
    await delay(HEALTH_POLL_MS);
  }
  throw new Error('Tempo limite ao iniciar o whisper-server.');
}

function parseServerResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'text' in parsed &&
      typeof parsed.text === 'string'
    ) {
      return parsed.text;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export async function startWhisperServer(input: {
  binary: string;
  modelPath: string;
}): Promise<WhisperServerHandle> {
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    input.binary,
    ['--model', input.modelPath, '--host', '127.0.0.1', '--port', String(port), '--no-timestamps'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let exitCode: number | null = null;
  let spawnError: Error | null = null;
  const closed = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      spawnError = error;
      exitCode = -1;
      resolve();
    });
    child.once('close', (code) => {
      exitCode = code ?? -1;
      resolve();
    });
  });

  async function stop(): Promise<void> {
    if (exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      closed,
      delay(KILL_GRACE_MS).then(() => {
        if (exitCode === null) child.kill('SIGKILL');
      }),
    ]);
    await closed;
  }

  try {
    await waitForReady({ url: `${baseUrl}/`, exited: () => exitCode });
  } catch (error: unknown) {
    await stop();
    if (spawnError !== null) throw spawnError;
    throw error;
  }

  return {
    modelPath: input.modelPath,
    async transcribe(request) {
      if (exitCode !== null) {
        throw new Error('whisper-server não está mais em execução.');
      }
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(request.wav)], { type: 'audio/wav' }),
        'audio.wav',
      );
      form.append('language', request.language);
      form.append('prompt', request.prompt);
      form.append('suppress_nst', 'true');
      form.append('temperature', '0.0');
      form.append('response_format', 'json');

      const response = await fetch(`${baseUrl}/inference`, {
        method: 'POST',
        body: form,
        signal: request.signal,
      });
      if (!response.ok) {
        throw new Error(`whisper-server retornou HTTP ${response.status}.`);
      }
      return parseServerResponse(await response.text());
    },
    stop,
  };
}
