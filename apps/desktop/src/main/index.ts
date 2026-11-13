import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { dataRoot } from '@inova/core/store';
import { providers } from '@inova/core/providers';
import { nodeRunner } from '@inova/node-io';
import { Notification, app, BrowserWindow, dialog, shell } from 'electron';
import * as pty from 'node-pty';
import { CHANNELS } from '../shared/api.js';
import { createChatRunner } from './chat.js';
import type { SpawnChild } from './chat.js';
import { createHandlers, isExternalWebUrl } from './handlers.js';
import { isAppUrl, registerIpc } from './ipc.js';
import { killProcessGroup } from './process-group.js';
import { createSessionManager } from './sessions.js';
import type { SpawnPty } from './sessions.js';
import { findBinary, loginShellPath } from './shell-env.js';
import { createVoiceHandlers, createVoiceService } from './voice.js';

const execFileAsync = promisify(execFile);
const SHELL_TIMEOUT_MS = 5000;
const WHISPER_TIMEOUT_MS = 120_000;
const WHISPER_MAX_OUTPUT_BYTES = 1024 * 1024;
const AUTO_ARCHIVE_INTERVAL_MS = 60 * 60 * 1000;
const appUrl =
  process.env['ELECTRON_RENDERER_URL'] ??
  pathToFileURL(join(__dirname, '../renderer/index.html')).href;
let mainWindow: BrowserWindow | undefined;
let cachedBaseEnv: Promise<NodeJS.ProcessEnv> | undefined;

function baseEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') {
    return Promise.resolve({
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    });
  }
  const defaultShell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
  cachedBaseEnv ??= loginShellPath({
    shell: process.env['SHELL'] ?? defaultShell,
    fallback: process.env['PATH'] ?? '',
    timeoutMs: SHELL_TIMEOUT_MS,
  }).then((path) => ({
    ...process.env,
    PATH: path,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }));
  return cachedBaseEnv;
}

function sendToWindow(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const spawnPty: SpawnPty = ({ file, args, cwd, env, cols, rows }) =>
  pty.spawn(file, args, { name: 'xterm-256color', cwd, env, cols, rows });

const sessions = createSessionManager({
  spawnPty,
  killTree: killProcessGroup,
  events: {
    data: (sessionId, data) => handlers?.handlePtyData(sessionId, data),
    exit: (sessionId, exitCode) => void handlers?.handlePtyExit(sessionId, exitCode),
  },
});

const spawnChild: SpawnChild = ({ file, args, cwd, env }) =>
  spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

let handlers: ReturnType<typeof createHandlers> | undefined;

const chat = createChatRunner({
  spawnChild,
  killTree: killProcessGroup,
  emit: (sessionId, event) => handlers?.handleChatEvent(sessionId, event),
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Inova',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) {
      shell.openExternal(url).catch((error: unknown) => {
        console.error('inova: failed to open external url', error);
      });
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('did-navigate', () => void closeAllSessions());
  window.webContents.on('render-process-gone', () => void closeAllSessions());
  mainWindow = window;
  window.loadURL(appUrl).catch((error: unknown) => {
    console.error('inova: failed to load', appUrl, error instanceof Error ? error.message : error);
    dialog.showErrorBox('Inova', 'Não foi possível carregar a interface.');
    app.quit();
  });
}

function closeAllSessions(): Promise<void> {
  const report = (error: unknown): void => console.error('inova: closeAll failed', error);
  return Promise.all([sessions.closeAll().catch(report), chat.closeAll().catch(report)]).then(
    () => undefined,
  );
}

async function pickFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function collectPtyOutput(): Promise<string> {
  const file = process.platform === 'win32' ? 'cmd.exe' : '/bin/echo';
  const args = process.platform === 'win32' ? ['/c', 'echo', 'pty-ok'] : ['pty-ok'];
  return new Promise((resolve) => {
    const child = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
    });
    let output = '';
    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit(() => resolve(output));
  });
}

function stripVt(text: string): string {
  // REGEX: remove VT OSC and CSI control sequences emitted by ConPTY
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .trim();
}

async function runSelftest(): Promise<void> {
  const output = stripVt(await collectPtyOutput());
  const ptyState = output.includes('pty-ok') ? 'pty-ok' : output;
  console.log(`selftest:${ptyState}:${Object.keys(providers).join(',')}`);
}

app.setName('InovaIDE');

void app.whenReady().then(async () => {
  if (process.env['INOVA_SELFTEST'] !== '1') {
    const created = createHandlers({
      root: dataRoot(process.env),
      runner: nodeRunner,
      sessions,
      chat,
      usageDeps: {
        platform: process.platform,
        runner: nodeRunner,
        fetch: (url, init) => globalThis.fetch(url, init),
        now: () => new Date(),
      },
      emit: (sessionId, event) => sendToWindow(CHANNELS.chatEvent, { sessionId, event }),
      emitLogin: (event) => sendToWindow(CHANNELS.loginEvent, event),
      emitInbox: (items) => sendToWindow(CHANNELS.inboxEvent, items),
      emitQueue: (queue) => sendToWindow(CHANNELS.queueEvent, queue),
      notify: ({ title, body }) => {
        if (Notification.isSupported()) new Notification({ title, body }).show();
      },
      openPath: async (path) => {
        const failure = await shell.openPath(path);
        if (failure !== '') throw new Error(failure);
      },
      baseEnv,
      pickFolder,
    });
    handlers = created;
    const autoArchive = (): void => {
      created.runAutoArchive().catch((error: unknown) => {
        console.error('inova: auto-archive failed', error);
      });
    };
    autoArchive();
    setInterval(autoArchive, AUTO_ARCHIVE_INTERVAL_MS);
    const whisperName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const voice = createVoiceService({
      modelDir: join(dataRoot(process.env), 'models'),
      binaryCandidates: [
        join(process.resourcesPath, 'whisper', whisperName),
        join(app.getAppPath(), 'resources', 'whisper', whisperName),
      ],
      findOnPath: async () => findBinary('whisper-cli', (await baseEnv())['PATH'] ?? ''),
      runWhisper: async ({ file, args, signal }) => {
        const { stdout } = await execFileAsync(file, args, {
          signal,
          timeout: WHISPER_TIMEOUT_MS,
          maxBuffer: WHISPER_MAX_OUTPUT_BYTES,
        });
        return stdout;
      },
      fetch: (url) => globalThis.fetch(url),
      onProgress: (progress) => sendToWindow(CHANNELS.voiceModelProgress, progress),
    });
    registerIpc({
      handlers: created,
      voice: createVoiceHandlers(voice),
      allowedOrigin: appUrl,
    });
    createWindow();
    return;
  }
  try {
    await runSelftest();
    app.exit(0);
  } catch (error: unknown) {
    console.error('selftest failed', error);
    app.exit(1);
  }
});

let shuttingDown = false;

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  void closeAllSessions().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
