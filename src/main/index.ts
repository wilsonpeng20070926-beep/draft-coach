import { join } from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { createChampionAttributeProvider } from "./catalog/championAttributes";
import { DataDragonChampionCatalog, type ChampionCatalog } from "./catalog/championCatalog";
import { createAppConfigStore, type AppConfigStore } from "./config/appConfigStore";
import { CachedMetaDataSource } from "./data/cache";
import type { MetaDataSource } from "./data/metaDataSource";
import { OpggMcpSource } from "./data/opggMcpSource";
import { createEmptyDraftState, inferDraftStateEnemyRoles, toDraftState } from "./draft/draftManager";
import { RecommendationEngine, RecommendationRunner } from "./engine/engine";
import { buildCandidatePool } from "./engine/candidatePool";
import { buildAnalysisBackedTeamContext } from "./engine/teamContextProvider";
import { createTeamContextProjection } from "./engine/teamContextProjection";
import { CounterModule } from "./engine/factors/counterModule";
import { CompFitModule } from "./engine/factors/compFitModule";
import { SynergyModule } from "./engine/factors/synergyModule";
import { TeamCounterModule } from "./engine/factors/teamCounterModule";
import { ipcChannels, type LcuStatus } from "./ipc";
import { LcuAdapter } from "./lcu/lcuAdapter";
import {
  DEFAULT_APP_CONFIG,
  INTERNAL_DATA_CONFIG,
  isWeightOnlyPatch,
  type AppConfig,
  type AppConfigPatch,
} from "../shared/config";
import type { DraftState, RecommendationUpdate } from "../shared/types";

const currentDirectory = __dirname;
const lcu = new LcuAdapter();
const DRAFT_PUSH_DEBOUNCE_MS = 250;

let mainWindow: BrowserWindow | null = null;
let catalog: ChampionCatalog | null = null;
let latestRawChampSelectSession: unknown = null;
let latestStatus: LcuStatus = {
  connection: "waiting",
  phase: null,
};
let draftPushTimer: NodeJS.Timeout | null = null;
let recommendationRunner: RecommendationRunner | null = null;
let opggSource: OpggMcpSource | null = null;
let metaSource: MetaDataSource | null = null;
let draftStateRunId = 0;
let configStore: AppConfigStore | null = null;
let currentConfig: AppConfig = DEFAULT_APP_CONFIG;
let latestDraftState: DraftState | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 640,
    minWidth: 320,
    minHeight: 460,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    resizable: true,
    show: false,
    title: "Draft Coach",
    webPreferences: {
      preload: join(currentDirectory, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    sendConfigChanged(currentConfig);
    sendLcuStatus(latestStatus);
    sendRecommendations(createEmptyRecommendationUpdate());

    if (process.env.DRAFT_COACH_SMOKE === "1") {
      void runSmokeCheck();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(currentDirectory, "../renderer/index.html"));
  }
}

async function runSmokeCheck(): Promise<void> {
  try {
    const result = await mainWindow?.webContents.executeJavaScript("window.api.ping()");
    console.log(`[Smoke] window.api.ping() -> ${String(result)}`);
    app.exit(result === "pong" ? 0 : 1);
  } catch (error) {
    console.error("[Smoke]", toError(error).message);
    app.exit(1);
  }
}

function sendLcuStatus(status: LcuStatus): void {
  latestStatus = status;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.lcuStatus, status);
  });
}

function sendChampSelectSession(session: unknown): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.champSelectSession, session);
  });
}

function sendDraftState(draftState: DraftState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.draftState, draftState);
  });
}

function sendRecommendations(update: RecommendationUpdate): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.recommendations, update);
  });
}

function sendConfigChanged(config: AppConfig): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.configChanged, config);
  });
}

function scheduleDraftStatePush(): void {
  if (draftPushTimer) {
    clearTimeout(draftPushTimer);
  }

  draftPushTimer = setTimeout(() => {
    draftPushTimer = null;
    void pushDraftState();
  }, DRAFT_PUSH_DEBOUNCE_MS);
}

async function pushDraftState(): Promise<void> {
  const runId = (draftStateRunId += 1);

  if (!catalog || !latestRawChampSelectSession) {
    const draftState = createEmptyDraftState(latestStatus.phase);
    sendDraftState(draftState);
    requestRecommendations(draftState);
    return;
  }

  const baseDraftState = toDraftState(latestRawChampSelectSession, latestStatus.phase, catalog);
  const draftState = await maybeInferEnemyRoles(baseDraftState);

  if (runId !== draftStateRunId) {
    return;
  }

  sendDraftState(draftState);
  requestRecommendations(draftState);
}

async function initializeCatalog(): Promise<ChampionCatalog> {
  const championCatalog = new DataDragonChampionCatalog(join(app.getPath("userData"), "cache"));
  await championCatalog.ready();
  console.log("[Catalog] Data Dragon version", championCatalog.version() || "unavailable");
  return championCatalog;
}

function initializeRecommendationRunner(championCatalog: ChampionCatalog): void {
  opggSource = new OpggMcpSource(championCatalog);
  const cachedSource = new CachedMetaDataSource(opggSource, {
    ttlMs: INTERNAL_DATA_CONFIG.opggCacheTtlMs,
    patchVersion: championCatalog.version(),
  });
  metaSource = cachedSource;
  const attributeProvider = createChampionAttributeProvider(championCatalog.version());
  const counterModule = new CounterModule(
    cachedSource,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const synergyModule = new SynergyModule(
    cachedSource,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const teamCounterModule = new TeamCounterModule(
    cachedSource,
    attributeProvider,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const compFitModule = new CompFitModule(
    cachedSource,
    attributeProvider,
    () => currentConfig.region,
    () => currentConfig.rank,
  );
  const engine = new RecommendationEngine(
    cachedSource,
    [counterModule, teamCounterModule, synergyModule, compFitModule],
    createRecommendationOptions,
    (draft, options) =>
      buildAnalysisBackedTeamContext(draft, cachedSource, attributeProvider, {
        region: options.region,
        rank: options.rank,
      }),
    (input) =>
      buildCandidatePool({
        ...input,
        getAttributes: attributeProvider.getAttributes,
      }),
  );

  recommendationRunner = new RecommendationRunner(engine);
}

function createRecommendationOptions() {
  return {
    region: currentConfig.region,
    rank: currentConfig.rank,
    topN: currentConfig.topN,
    candidateCap: INTERNAL_DATA_CONFIG.candidateCap,
    weights: currentConfig.weights,
    shrinkK: currentConfig.shrinkK,
    pickRateFloor: currentConfig.pickRateFloor,
    metaRolePresenceFloor: INTERNAL_DATA_CONFIG.metaRolePresenceFloor,
  };
}

async function maybeInferEnemyRoles(draftState: DraftState): Promise<DraftState> {
  const source = metaSource;

  if (!source || draftState.phase !== "champSelect") {
    return draftState;
  }

  try {
    return await inferDraftStateEnemyRoles(draftState, (champion) =>
      source.getChampionRoleFit(champion, currentConfig.region, currentConfig.rank),
    );
  } catch (error) {
    console.error("[RoleInference]", toError(error).message);
    return draftState;
  }
}

function requestRecommendations(draftState: DraftState): void {
  latestDraftState = draftState;

  if (!recommendationRunner || draftState.phase !== "champSelect" || !draftState.localPlayer?.role) {
    sendRecommendations(createEmptyRecommendationUpdate());
    return;
  }

  sendRecommendations({
    recommendations: [],
    loading: true,
    limitedDataNote: null,
    teamContext: null,
  });

  void recommendationRunner
    .recommendLatest(draftState)
    .then((result) => {
      if (!result) {
        return;
      }

      sendRecommendations({
        recommendations: result.recommendations,
        loading: false,
        limitedDataNote: result.limitedDataNote,
        teamContext: createTeamContextProjection(result.teamContext),
      });
    })
    .catch((error: unknown) => {
      console.error("[Recommendations]", toError(error).message);
      sendRecommendations({
        recommendations: [],
        loading: false,
        limitedDataNote: "Recommendation data is unavailable right now.",
        teamContext: null,
      });
    });
}

function rerankLatestRecommendations(): void {
  const result = recommendationRunner?.rerankLatest();

  if (result) {
    sendRecommendations({
      recommendations: result.recommendations,
      loading: false,
      limitedDataNote: result.limitedDataNote,
      teamContext: createTeamContextProjection(result.teamContext),
    });
    return;
  }

  if (latestDraftState) {
    requestRecommendations(latestDraftState);
  }
}

function createEmptyRecommendationUpdate(): RecommendationUpdate {
  return {
    recommendations: [],
    loading: false,
    limitedDataNote: null,
    teamContext: null,
  };
}

function startLcu(championCatalog: ChampionCatalog): void {
  catalog = championCatalog;
  sendLcuStatus({ connection: "waiting", phase: null });
  const draftState = createEmptyDraftState(null);
  sendDraftState(draftState);
  requestRecommendations(draftState);

  lcu.on("connected", () => {
    sendLcuStatus({ connection: "connected", phase: latestStatus.phase });
  });

  lcu.on("disconnected", () => {
    latestRawChampSelectSession = null;
    sendLcuStatus({ connection: "waiting", phase: null });
    const draftState = createEmptyDraftState(null);
    sendDraftState(draftState);
    requestRecommendations(draftState);
  });

  lcu.on("phaseChanged", (phase) => {
    sendLcuStatus({ connection: "connected", phase });
    scheduleDraftStatePush();
  });

  lcu.on("champSelectSession", (session) => {
    latestRawChampSelectSession = session;
    console.log("[LCU] champ-select session", summarizeChampSelectSession(session));
    sendChampSelectSession(session);
    scheduleDraftStatePush();
  });

  lcu.on("error", (error) => {
    console.error("[LCU]", error.message);
  });

  void lcu.start().catch((error: unknown) => {
    console.error("[LCU] failed to start", error);
    sendLcuStatus({ connection: "waiting", phase: null });
  });
}

ipcMain.handle(ipcChannels.ping, () => "pong");
ipcMain.handle(ipcChannels.configGet, () => currentConfig);
ipcMain.handle(ipcChannels.configSet, async (_event, patch: AppConfigPatch) => {
  if (!configStore) {
    return currentConfig;
  }

  const config = await configStore.set(patch);
  currentConfig = config;
  sendConfigChanged(config);

  if (isWeightOnlyPatch(patch)) {
    rerankLatestRecommendations();
  } else if (latestDraftState) {
    requestRecommendations(latestDraftState);
  }

  return config;
});

app.whenReady().then(async () => {
  configStore = createAppConfigStore(app.getPath("userData"));
  currentConfig = await configStore.load();
  createWindow();
  const championCatalog = await initializeCatalog();
  initializeRecommendationRunner(championCatalog);
  startLcu(championCatalog);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  lcu.stop();
  void opggSource?.close();
});

interface RawChampSelectPlayer {
  cellId?: unknown;
  championId?: unknown;
  assignedPosition?: unknown;
}

interface RawChampSelectSession {
  localPlayerCellId?: unknown;
  myTeam?: unknown;
  theirTeam?: unknown;
  bans?: {
    myTeamBans?: unknown;
    theirTeamBans?: unknown;
  };
  actions?: unknown;
}

interface ChampSelectLogSummary {
  localPlayerCellId: number | null;
  allyPicks: string[];
  enemyPicks: string[];
  banCount: number;
  actionCount: number;
}

function summarizeChampSelectSession(raw: unknown): ChampSelectLogSummary {
  const session = asChampSelectSession(raw);
  const bans = [
    ...toNumberArray(session.bans?.myTeamBans),
    ...toNumberArray(session.bans?.theirTeamBans),
  ].filter((championId) => championId > 0);

  return {
    localPlayerCellId: toNullableNumber(session.localPlayerCellId),
    allyPicks: summarizeTeam(session.myTeam),
    enemyPicks: summarizeTeam(session.theirTeam),
    banCount: bans.length,
    actionCount: countActions(session.actions),
  };
}

function asChampSelectSession(raw: unknown): RawChampSelectSession {
  return raw && typeof raw === "object" ? (raw as RawChampSelectSession) : {};
}

function summarizeTeam(team: unknown): string[] {
  if (!Array.isArray(team)) {
    return [];
  }

  return team.map((member) => {
    const player = member as RawChampSelectPlayer;
    const championId = toNullableNumber(player.championId);
    const position =
      typeof player.assignedPosition === "string" && player.assignedPosition.length > 0
        ? player.assignedPosition
        : "unassigned";

    return `${formatChampionId(championId)}:${position}`;
  });
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function countActions(actions: unknown): number {
  if (!Array.isArray(actions)) {
    return 0;
  }

  return actions.reduce((count, group) => count + (Array.isArray(group) ? group.length : 0), 0);
}

function formatChampionId(championId: number | null): string {
  return championId && championId > 0 ? String(championId) : "none";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
