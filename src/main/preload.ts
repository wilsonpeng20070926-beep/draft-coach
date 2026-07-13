import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, AppConfigPatch } from "../shared/config";
import type { ProDataStatus } from "../shared/proData";
import type {
  DraftSimulationState,
  DraftState,
  RecommendationUpdate,
} from "../shared/types";
import type { DraftCoachApi, LcuStatus } from "./ipc";
import { ipcChannels } from "./ipc";

const api: DraftCoachApi = {
  ping: () => ipcRenderer.invoke(ipcChannels.ping),
  getProDataStatus: () => ipcRenderer.invoke(ipcChannels.proDataGetStatus),
  refreshProData: () => ipcRenderer.invoke(ipcChannels.proDataRefresh),
  onProDataStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: ProDataStatus,
    ): void => {
      callback(status);
    };

    ipcRenderer.on(ipcChannels.proDataStatus, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.proDataStatus, listener);
    };
  },
  getConfig: () => ipcRenderer.invoke(ipcChannels.configGet),
  setConfig: (patch: AppConfigPatch) => ipcRenderer.invoke(ipcChannels.configSet, patch),
  setDraftTarget: (cellId: number) => ipcRenderer.invoke(ipcChannels.draftTargetSet, cellId),
  setDraftThreatTarget: (cellId, role) =>
    ipcRenderer.invoke(ipcChannels.draftThreatTargetSet, cellId, role),
  pinLiveThreat: (championId, role) =>
    ipcRenderer.invoke(ipcChannels.draftThreatPin, championId, role),
  removeLiveThreat: (championId) =>
    ipcRenderer.invoke(ipcChannels.draftThreatRemove, championId),
  getChampions: () => ipcRenderer.invoke(ipcChannels.catalogGet),
  onChampions: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      champions: Awaited<ReturnType<DraftCoachApi["getChampions"]>>,
    ): void => {
      callback(champions);
    };

    ipcRenderer.on(ipcChannels.catalogChanged, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.catalogChanged, listener);
    };
  },
  getSimulationState: () => ipcRenderer.invoke(ipcChannels.simulationGet),
  applySimulationCommand: (command) =>
    ipcRenderer.invoke(ipcChannels.simulationCommand, command),
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
  onSimulationState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: DraftSimulationState,
    ): void => {
      callback(state);
    };

    ipcRenderer.on(ipcChannels.simulationState, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.simulationState, listener);
    };
  },
  onSimulationRecommendations: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: RecommendationUpdate,
    ): void => {
      callback(update);
    };

    ipcRenderer.on(ipcChannels.simulationRecommendations, listener);

    return () => {
      ipcRenderer.removeListener(ipcChannels.simulationRecommendations, listener);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);
