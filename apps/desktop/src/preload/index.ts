import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { CHANNELS } from '../shared/api.js';
import type { InovaApi } from '../shared/api.js';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: InovaApi = {
  listAccounts: () => ipcRenderer.invoke(CHANNELS.listAccounts),
  addAccount: (input) => ipcRenderer.invoke(CHANNELS.addAccount, input),
  removeAccount: (input) => ipcRenderer.invoke(CHANNELS.removeAccount, input),
  listProjects: () => ipcRenderer.invoke(CHANNELS.listProjects),
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  bindProject: (input) => ipcRenderer.invoke(CHANNELS.bindProject, input),
  unbindProject: (input) => ipcRenderer.invoke(CHANNELS.unbindProject, input),
  openProject: (input) => ipcRenderer.invoke(CHANNELS.openProject, input),
  openLogin: (input) => ipcRenderer.invoke(CHANNELS.openLogin, input),
  ptyWrite: (sessionId, data) => ipcRenderer.send(CHANNELS.ptyWrite, sessionId, data),
  ptyResize: (input) => ipcRenderer.send(CHANNELS.ptyResize, input),
  ptyClose: (sessionId) => ipcRenderer.send(CHANNELS.ptyClose, sessionId),
  onPtyData: (callback) => subscribe(CHANNELS.ptyData, callback),
  onPtyExit: (callback) => subscribe(CHANNELS.ptyExit, callback),
};

contextBridge.exposeInMainWorld('inova', api);
