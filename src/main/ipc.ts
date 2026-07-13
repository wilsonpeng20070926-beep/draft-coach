import type { AppConfig, AppConfigPatch } from "../shared/config";
import type { ProDataStatus } from "../shared/proData";
import type {
  ChampionRef,
  DraftSimulationState,
  DraftState,
  RecommendationUpdate,
  Role,
  SimulationCommand,
} from "../shared/types";

export const ipcChannels = {
  ping: "app:ping",
  proDataGetStatus: "pro-data:status:get",
  proDataRefresh: "pro-data:refresh",
  proDataStatus: "pro-data:status",
  lcuStatus: "lcu:status",
  draftState: "draft:state",
  draftTargetSet: "draft:target:set",
  draftThreatTargetSet: "draft:threat-target:set",
  draftThreatPin: "draft:threat:pin",
  draftThreatRemove: "draft:threat:remove",
  recommendations: "engine:recommendations",
  catalogGet: "catalog:get",
  catalogChanged: "catalog:changed",
  simulationGet: "simulation:get",
  simulationCommand: "simulation:command",
  simulationState: "simulation:state",
  simulationRecommendations: "simulation:recommendations",
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
  getProDataStatus: () => Promise<ProDataStatus>;
  refreshProData: () => Promise<ProDataStatus>;
  onProDataStatus: (callback: (status: ProDataStatus) => void) => () => void;
  onLcuStatus: (callback: (status: LcuStatus) => void) => () => void;
  onDraftState: (callback: (draftState: DraftState) => void) => () => void;
  setDraftTarget: (cellId: number) => Promise<void>;
  setDraftThreatTarget: (cellId: number, role: Role) => Promise<void>;
  pinLiveThreat: (championId: number, role: Role | null) => Promise<void>;
  removeLiveThreat: (championId: number) => Promise<void>;
  onRecommendations: (callback: (update: RecommendationUpdate) => void) => () => void;
  getChampions: () => Promise<ChampionRef[]>;
  onChampions: (callback: (champions: ChampionRef[]) => void) => () => void;
  getSimulationState: () => Promise<DraftSimulationState>;
  applySimulationCommand: (command: SimulationCommand) => Promise<DraftSimulationState>;
  onSimulationState: (callback: (state: DraftSimulationState) => void) => () => void;
  onSimulationRecommendations: (
    callback: (update: RecommendationUpdate) => void,
  ) => () => void;
  getConfig: () => Promise<AppConfig>;
  setConfig: (patch: AppConfigPatch) => Promise<AppConfig>;
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void;
}
