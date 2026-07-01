import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, AppConfigPatch } from "../shared/config";
import type { DraftState, RecommendationUpdate } from "../shared/types";
import type { DraftCoachApi, LcuStatus } from "./ipc";
import { ipcChannels } from "./ipc";

const api: DraftCoachApi = {
  ping: () => ipcRenderer.invoke(ipcChannels.ping),
  getConfig: () => ipcRenderer.invoke(ipcChannels.configGet),
  setConfig: (patch: AppConfigPatch) => ipcRenderer.invoke(ipcChannels.configSet, patch),
  onConfigChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, config: AppConfig): void => {
      callback(config);
    };

    ipcRenderer.on(ipcChannels.configChanged, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.configChanged, listener);
    };
  },
  onLcuStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: LcuStatus): void => {
      callback(status);
    };

    ipcRenderer.on(ipcChannels.lcuStatus, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.lcuStatus, listener);
    };
  },
  onChampSelectSession: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, session: unknown): void => {
      callback(session);
    };

    ipcRenderer.on(ipcChannels.champSelectSession, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.champSelectSession, listener);
    };
  },
  onDraftState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, draftState: DraftState): void => {
      callback(draftState);
    };

    ipcRenderer.on(ipcChannels.draftState, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.draftState, listener);
    };
  },
  onRecommendations: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: RecommendationUpdate,
    ): void => {
      callback(update);
    };

    ipcRenderer.on(ipcChannels.recommendations, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.recommendations, listener);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);
