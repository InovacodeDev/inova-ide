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
  listSessions: (input) => ipcRenderer.invoke(CHANNELS.listSessions, input),
  createSession: (input) => ipcRenderer.invoke(CHANNELS.createSession, input),
  renameSession: (input) => ipcRenderer.invoke(CHANNELS.renameSession, input),
  deleteSession: (input) => ipcRenderer.invoke(CHANNELS.deleteSession, input),
  loadTranscript: (input) => ipcRenderer.invoke(CHANNELS.loadTranscript, input),
  sendMessage: (input) => ipcRenderer.invoke(CHANNELS.sendMessage, input),
  cancelTurn: (sessionId) => ipcRenderer.send(CHANNELS.cancelTurn, sessionId),
  getUsage: (input) => ipcRenderer.invoke(CHANNELS.getUsage, input),
  onChatEvent: (callback) => subscribe(CHANNELS.chatEvent, callback),
  openLogin: (input) => ipcRenderer.invoke(CHANNELS.openLogin, input),
  ptyWrite: (sessionId, data) => ipcRenderer.send(CHANNELS.ptyWrite, sessionId, data),
  ptyResize: (input) => ipcRenderer.send(CHANNELS.ptyResize, input),
  ptyClose: (sessionId) => ipcRenderer.send(CHANNELS.ptyClose, sessionId),
  onPtyData: (callback) => subscribe(CHANNELS.ptyData, callback),
  onPtyExit: (callback) => subscribe(CHANNELS.ptyExit, callback),
};

contextBridge.exposeInMainWorld('inova', api);
