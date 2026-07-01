import type { AppConfig, AppConfigPatch } from "../shared/config";
import type { DraftState, RecommendationUpdate } from "../shared/types";

export const ipcChannels = {
  ping: "app:ping",
  lcuStatus: "lcu:status",
  champSelectSession: "lcu:champSelectSession",
  draftState: "draft:state",
  recommendations: "engine:recommendations",
  configGet: "config:get",
  configSet: "config:set",
  configChanged: "config:changed",
} as const;

export type IpcChannel = (typeof ipcChannels)[keyof typeof ipcChannels];

export type LcuConnectionState = "waiting" | "connected" | "disconnected";

export interface LcuStatus {
  connection: LcuConnectionState;
  phase: string | null;
}

export interface DraftCoachApi {
  ping: () => Promise<string>;
  onLcuStatus: (callback: (status: LcuStatus) => void) => () => void;
  onChampSelectSession: (callback: (session: unknown) => void) => () => void;
  onDraftState: (callback: (draftState: DraftState) => void) => () => void;
  onRecommendations: (callback: (update: RecommendationUpdate) => void) => () => void;
  getConfig: () => Promise<AppConfig>;
  setConfig: (patch: AppConfigPatch) => Promise<AppConfig>;
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void;
}
