import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  updateSession: (input) => ipcRenderer.invoke(CHANNELS.updateSession, input),
  getDefaultModes: () => ipcRenderer.invoke(CHANNELS.getDefaultModes),
  setDefaultMode: (input) => ipcRenderer.invoke(CHANNELS.setDefaultMode, input),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  updateSettings: (input) => ipcRenderer.invoke(CHANNELS.updateSettings, input),
  sendTestNotification: () => ipcRenderer.invoke(CHANNELS.sendTestNotification),
  openDataFolder: () => ipcRenderer.invoke(CHANNELS.openDataFolder),
  deleteSession: (input) => ipcRenderer.invoke(CHANNELS.deleteSession, input),
  getWorktreeStatus: (input) => ipcRenderer.invoke(CHANNELS.getWorktreeStatus, input),
  applyWorktree: (input) => ipcRenderer.invoke(CHANNELS.applyWorktree, input),
  restoreCheckpoint: (input) => ipcRenderer.invoke(CHANNELS.restoreCheckpoint, input),
  detectProjectChecks: (input) => ipcRenderer.invoke(CHANNELS.detectProjectChecks, input),
  updateProjectVerification: (input) =>
    ipcRenderer.invoke(CHANNELS.updateProjectVerification, input),
  runVerification: (input) => ipcRenderer.invoke(CHANNELS.runVerification, input),
  getWorkspace: () => ipcRenderer.invoke(CHANNELS.getWorkspace),
  saveWorkspace: (input) => ipcRenderer.invoke(CHANNELS.saveWorkspace, input),
  loadTranscript: (input) => ipcRenderer.invoke(CHANNELS.loadTranscript, input),
  sendMessage: (input) => ipcRenderer.invoke(CHANNELS.sendMessage, input),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getVoiceStatus: () => ipcRenderer.invoke(CHANNELS.getVoiceStatus),
  downloadVoiceModel: () => ipcRenderer.invoke(CHANNELS.downloadVoiceModel),
  transcribeAudio: (input) => ipcRenderer.invoke(CHANNELS.transcribeAudio, input),
  onVoiceModelProgress: (callback) => subscribe(CHANNELS.voiceModelProgress, callback),
  enqueueTurn: (input) => ipcRenderer.invoke(CHANNELS.enqueueTurn, input),
  cancelQueuedTurn: (input) => ipcRenderer.invoke(CHANNELS.cancelQueuedTurn, input),
  listTurnQueue: () => ipcRenderer.invoke(CHANNELS.listTurnQueue),
  switchSessionAccount: (input) => ipcRenderer.invoke(CHANNELS.switchSessionAccount, input),
  handoffSession: (input) => ipcRenderer.invoke(CHANNELS.handoffSession, input),
  forkSession: (input) => ipcRenderer.invoke(CHANNELS.forkSession, input),
  listInbox: () => ipcRenderer.invoke(CHANNELS.listInbox),
  markInboxRead: (input) => ipcRenderer.invoke(CHANNELS.markInboxRead, input),
  clearReadInbox: () => ipcRenderer.invoke(CHANNELS.clearReadInbox),
  reportUiFocus: (input) => ipcRenderer.send(CHANNELS.reportUiFocus, input),
  cancelTurn: (sessionId) => ipcRenderer.send(CHANNELS.cancelTurn, sessionId),
  getUsage: (input) => ipcRenderer.invoke(CHANNELS.getUsage, input),
  listModels: (input) => ipcRenderer.invoke(CHANNELS.listModels, input),
  searchFiles: (input) => ipcRenderer.invoke(CHANNELS.searchFiles, input),
  listCommands: (input) => ipcRenderer.invoke(CHANNELS.listCommands, input),
  startComparison: (input) => ipcRenderer.invoke(CHANNELS.startComparison, input),
  getComparisonDiff: (input) => ipcRenderer.invoke(CHANNELS.getComparisonDiff, input),
  resolveComparison: (input) => ipcRenderer.invoke(CHANNELS.resolveComparison, input),
  previewProfileSync: (input) => ipcRenderer.invoke(CHANNELS.previewProfileSync, input),
  applyProfileSync: (input) => ipcRenderer.invoke(CHANNELS.applyProfileSync, input),
  onChatEvent: (callback) => subscribe(CHANNELS.chatEvent, callback),
  onInboxEvent: (callback) => subscribe(CHANNELS.inboxEvent, callback),
  onQueueEvent: (callback) => subscribe(CHANNELS.queueEvent, callback),
  startLogin: (input) => ipcRenderer.invoke(CHANNELS.startLogin, input),
  submitLoginCode: (input) => ipcRenderer.invoke(CHANNELS.submitLoginCode, input),
  cancelLogin: (sessionId) => ipcRenderer.send(CHANNELS.cancelLogin, sessionId),
  onLoginEvent: (callback) => subscribe(CHANNELS.loginEvent, callback),
};

contextBridge.exposeInMainWorld('inova', api);
