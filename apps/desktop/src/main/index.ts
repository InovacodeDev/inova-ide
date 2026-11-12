import { join } from 'node:path';
import { dataRoot } from '@inova/core/store';
import { providers } from '@inova/core/providers';
import { nodeRunner } from '@inova/node-io';
import { app, BrowserWindow, dialog } from 'electron';
import * as pty from 'node-pty';
import { CHANNELS } from '../shared/api.js';
import { createHandlers } from './handlers.js';
import { registerIpc } from './ipc.js';
import { createSessionManager } from './sessions.js';
import type { SpawnPty } from './sessions.js';
import { loginShellPath } from './shell-env.js';

const SHELL_TIMEOUT_MS = 5000;
let mainWindow: BrowserWindow | undefined;
let cachedBaseEnv: Promise<NodeJS.ProcessEnv> | undefined;

function baseEnv(): Promise<NodeJS.ProcessEnv> {
  cachedBaseEnv ??= loginShellPath({
    shell: process.env['SHELL'] ?? '/bin/zsh',
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
  events: {
    data: (sessionId, data) => sendToWindow(CHANNELS.ptyData, { sessionId, data }),
    exit: (sessionId, exitCode) => sendToWindow(CHANNELS.ptyExit, { sessionId, exitCode }),
  },
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow = window;

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function pickFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function collectPtyOutput(): Promise<string> {
  return new Promise((resolve) => {
    const child = pty.spawn('/bin/echo', ['pty-ok'], {
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

async function runSelftest(): Promise<void> {
  const output = await collectPtyOutput();
  console.log(`selftest:${output.trim()}:${Object.keys(providers).join(',')}`);
}

void app.whenReady().then(async () => {
  if (process.env['INOVA_SELFTEST'] !== '1') {
    const handlers = createHandlers({
      root: dataRoot(process.env),
      runner: nodeRunner,
      sessions,
      baseEnv,
      pickFolder,
    });
    registerIpc({ handlers, sessions });
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

app.on('window-all-closed', () => {
  sessions.closeAll();
  app.quit();
});
