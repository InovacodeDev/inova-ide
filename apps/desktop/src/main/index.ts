import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getSettings } from '@inova/core/settings';
import { dataRoot } from '@inova/core/store';
import { providers } from '@inova/core/providers';
import { nodeRunner } from '@inova/node-io';
import { Notification, app, BrowserWindow, dialog, shell } from 'electron';
import * as pty from 'node-pty';
import { CHANNELS } from '../shared/api.js';
import type { AttachmentKind, PickedAttachment } from '../shared/api.js';
import { createChatRunner } from './chat.js';
import type { SpawnChild } from './chat.js';
import { createHandlers, isExternalWebUrl } from './handlers.js';
import { isAppUrl, registerIpc } from './ipc.js';
import { NOTIFICATION_SETTINGS_URL, createNotifier } from './notifications.js';
import { killProcessGroup } from './process-group.js';
import {
  INSTALL_TIMEOUT_MS,
  WINGET_PACKAGE_ID,
  createUpdateInstaller,
  createUpdateService,
} from './updates.js';
import { createSessionManager } from './sessions.js';
import type { SpawnPty } from './sessions.js';
import { findBinary, loginShellPath } from './shell-env.js';
import { createVoiceHandlers, createVoiceService } from './voice.js';
import { createVoiceDockerSetup } from './voice-docker.js';
import { listOllamaModels, polishTranscript, probeOllamaEndpoint } from './voice-polish.js';
import { startWhisperServer } from './whisper-server.js';

const execFileAsync = promisify(execFile);
const SHELL_TIMEOUT_MS = 5000;
const WHISPER_TIMEOUT_MS = 120_000;
const WHISPER_MAX_OUTPUT_BYTES = 1024 * 1024;
const AUTO_ARCHIVE_INTERVAL_MS = 60 * 60 * 1000;
const appUrl =
  process.env['ELECTRON_RENDERER_URL'] ??
  pathToFileURL(join(__dirname, '../renderer/index.html')).href;
const notificationSettingsUrl = NOTIFICATION_SETTINGS_URL[process.platform];
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
let disposeVoice: (() => Promise<void>) | undefined;

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
  return Promise.all([
    sessions.closeAll().catch(report),
    chat.closeAll().catch(report),
    disposeVoice ? disposeVoice().catch(report) : Promise.resolve(),
  ]).then(() => undefined);
}

async function pickFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

const ATTACHMENT_FILTERS: Readonly<Record<AttachmentKind, Electron.FileFilter[]>> = {
  images: [
    {
      name: 'Fotos e imagens',
      extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'],
    },
  ],
  documents: [
    {
      name: 'Documentos',
      extensions: [
        'pdf',
        'md',
        'txt',
        'doc',
        'docx',
        'rtf',
        'csv',
        'json',
        'xls',
        'xlsx',
        'ppt',
        'pptx',
      ],
    },
  ],
  any: [],
};

async function pickAttachments(kind: AttachmentKind): Promise<PickedAttachment[]> {
  const properties: Electron.OpenDialogOptions['properties'] =
    kind === 'any'
      ? ['openFile', 'openDirectory', 'multiSelections']
      : ['openFile', 'multiSelections'];
  const options: Electron.OpenDialogOptions = {
    properties,
    filters: [...ATTACHMENT_FILTERS[kind]],
  };
  const window = BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return Promise.all(
    result.filePaths.map(async (path) => ({ path, isDirectory: (await stat(path)).isDirectory() })),
  );
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
    const notifier = createNotifier({
      platform: process.platform,
      isSupported: () => Notification.isSupported(),
      showNative: ({ title, body }) =>
        new Promise((resolve) => {
          const notification = new Notification({ title, body });
          notification.once('show', () => resolve(null));
          notification.once('failed', (_event, error) => resolve(error));
          notification.show();
        }),
      runOsascript: async (args) => {
        await execFileAsync('/usr/bin/osascript', args, { timeout: SHELL_TIMEOUT_MS });
      },
    });
    const updates = createUpdateService({
      current: app.getVersion(),
      fetch: (url, init) => globalThis.fetch(url, init),
      onAvailable: (info) => {
        sendToWindow(CHANNELS.updateAvailable, info);
        void notifier({
          title: 'Inova',
          body: `Nova versão do Inova IDE: v${info.latest ?? ''} disponível`,
        });
      },
    });
    const installer = createUpdateInstaller({
      platform: process.platform,
      isPackaged: app.isPackaged,
      current: app.getVersion(),
      execPath: process.execPath,
      findBrew: async () =>
        (await findBinary('brew', (await baseEnv())['PATH'] ?? '')) ??
        (await findBinary('brew', '/opt/homebrew/bin:/usr/local/bin')),
      run: async (file, args) => {
        await execFileAsync(file, args, { env: await baseEnv(), timeout: INSTALL_TIMEOUT_MS });
      },
      readBundleVersion: async (bundle) => {
        const { stdout } = await execFileAsync(
          '/usr/bin/plutil',
          [
            '-extract',
            'CFBundleShortVersionString',
            'raw',
            '-o',
            '-',
            `${bundle}/Contents/Info.plist`,
          ],
          { timeout: SHELL_TIMEOUT_MS },
        );
        return stdout.trim();
      },
      relaunch: () => {
        app.relaunch();
        app.quit();
      },
      quit: () => app.quit(),
      isWinInstalled: (execPath) => existsSync(join(dirname(execPath), 'Uninstall InovaIDE.exe')),
      findWinget: async () => {
        const env = await baseEnv();
        const candidates = [
          'winget.exe',
          ...(process.env['LOCALAPPDATA']
            ? [join(process.env['LOCALAPPDATA'], 'Microsoft', 'WindowsApps', 'winget.exe')]
            : []),
        ];
        for (const candidate of candidates) {
          try {
            await execFileAsync(candidate, ['--version'], { env, timeout: SHELL_TIMEOUT_MS });
            return candidate;
          } catch {
            continue;
          }
        }
        return undefined;
      },
      runOutput: async (file, args) => {
        const { stdout } = await execFileAsync(file, args, {
          env: await baseEnv(),
          timeout: INSTALL_TIMEOUT_MS,
          encoding: 'utf8',
        });
        return stdout;
      },
      spawnWinUpgrade: ({ winget, execPath, pid }) => {
        const psPath = join(
          process.env['SystemRoot'] ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        const script = [
          '$pidToWait = [int]$env:INOVA_WAIT_PID',
          'if ($pidToWait -gt 0) { while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 } }',
          `& $env:INOVA_WINGET_BIN upgrade --id ${WINGET_PACKAGE_ID} --exact --silent --accept-package-agreements --accept-source-agreements`,
          'if ($env:INOVA_APP_EXE -and (Test-Path -LiteralPath $env:INOVA_APP_EXE)) { Start-Process -FilePath $env:INOVA_APP_EXE }',
        ].join('; ');
        return new Promise((resolve, reject) => {
          const child = spawn(
            psPath,
            [
              '-NoProfile',
              '-NonInteractive',
              '-WindowStyle',
              'Hidden',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              script,
            ],
            {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: {
                ...process.env,
                INOVA_WINGET_BIN: winget,
                INOVA_APP_EXE: execPath,
                INOVA_WAIT_PID: String(pid),
              },
            },
          );
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
          child.once('error', reject);
        });
      },
      onProgress: (stage) => sendToWindow(CHANNELS.updateProgress, stage),
    });
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
      emitQueuePaused: (sessionIds) => sendToWindow(CHANNELS.queuePausedEvent, sessionIds),
      emitFailover: (event) => sendToWindow(CHANNELS.failoverEvent, event),
      notify: notifier,
      updates,
      installUpdate: installer.install,
      openExternal: (url) => shell.openExternal(url),
      ...(notificationSettingsUrl === undefined
        ? {}
        : { openNotificationSettings: () => shell.openExternal(notificationSettingsUrl) }),
      openPath: async (path) => {
        const failure = await shell.openPath(path);
        if (failure !== '') throw new Error(failure);
      },
      baseEnv,
      pickFolder,
      pickAttachments,
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
    const whisperServerName =
      process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
    const setupDocker = createVoiceDockerSetup({
      findDocker: async () => {
        const envPath = (await baseEnv())['PATH'] ?? '';
        const extraPath =
          process.platform === 'darwin'
            ? `${envPath}:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin`
            : envPath;
        return findBinary('docker', extraPath);
      },
      runDocker: async ({ file, args }) => {
        const { stdout } = await execFileAsync(file, args, {
          env: await baseEnv(),
          timeout: INSTALL_TIMEOUT_MS,
          maxBuffer: WHISPER_MAX_OUTPUT_BYTES,
        });
        return stdout;
      },
      probeEndpoint: probeOllamaEndpoint,
      fetch: (url, init) => globalThis.fetch(url, init),
      onProgress: (progress) => sendToWindow(CHANNELS.voiceDockerProgress, progress),
    });
    const voice = createVoiceService({
      modelDir: join(dataRoot(process.env), 'models'),
      getModelId: async () => (await getSettings(dataRoot(process.env))).voice.modelId,
      getVoiceSettings: async () => (await getSettings(dataRoot(process.env))).voice,
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
      serverBinaryCandidates: [
        join(process.resourcesPath, 'whisper', whisperServerName),
        join(app.getAppPath(), 'resources', 'whisper', whisperServerName),
      ],
      findServerOnPath: async () => findBinary('whisper-server', (await baseEnv())['PATH'] ?? ''),
      startServer: startWhisperServer,
      polish: polishTranscript,
      listPolishModels: listOllamaModels,
      probePolishEndpoint: probeOllamaEndpoint,
      setupDocker,
      fetch: (url, init) => globalThis.fetch(url, init),
      onProgress: (progress) => sendToWindow(CHANNELS.voiceModelProgress, progress),
    });
    disposeVoice = voice.dispose;
    registerIpc({
      handlers: created,
      voice: createVoiceHandlers(voice),
      allowedOrigin: appUrl,
    });
    createWindow();
    updates.start();
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
