import { join } from 'node:path';
import { providers } from '@inova/core/providers';
import { app, BrowserWindow } from 'electron';
import * as pty from 'node-pty';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Inova',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
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

app.on('window-all-closed', () => app.quit());
