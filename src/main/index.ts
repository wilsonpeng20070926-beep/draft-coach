import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { createChampionAttributeProvider } from "./catalog/championAttributes";
import { DataDragonChampionCatalog, type ChampionCatalog } from "./catalog/championCatalog";
import { createAppConfigStore, type AppConfigStore } from "./config/appConfigStore";
import { CachedMetaDataSource } from "./data/cache";
import {
  CatalogFallbackMetaDataSource,
  ResilientMetaDataSource,
} from "./data/catalogFallbackSource";
import type { MetaDataSource } from "./data/metaDataSource";
import { OpggMcpSource } from "./data/opggMcpSource";
import { buildProDataSnapshot } from "./data/pro/aggregate";
import {
  LeaguepediaCargoAdapter,
  leaguepediaBotAuthenticationFromEnvironment,
} from "./data/pro/leaguepediaCargo";
import { OracleElixirCsvAdapter } from "./data/pro/oraclesElixirCsv";
import { deriveProPatchWindow } from "./data/pro/patchWindow";
import {
  SnapshotProAnalyticsProvider,
  type ProAnalyticsProvider,
  type ProArchetype,
} from "./data/pro/proAnalytics";
import {
  StaticSnapshotProDataSource,
  type ProDataSource,
} from "./data/pro/proDataSource";
import {
  applyDraftRoleOverrides,
  createEmptyDraftState,
  inferDraftStateEnemyRoles,
  toDraftState,
} from "./draft/draftManager";
import {
  applySimulationCommand,
  createDraftSimulationState,
  rankAnticipatedThreats,
} from "./draft/draftSimulator";
import {
  createDraftTargetSelectionState,
  draftTargetKey,
  reconcileDraftTargetSelection,
  selectManualDraftTarget,
  type DraftTargetSelectionState,
} from "./draft/targetSelection";
import { RecommendationEngine, RecommendationRunner } from "./engine/engine";
import { buildCandidatePool } from "./engine/candidatePool";
import { buildAnalysisBackedTeamContext } from "./engine/teamContextProvider";
import { createTeamContextProjection } from "./engine/teamContextProjection";
import {
  RankedThreatForecastProvider,
  type ThreatForecastProvider,
} from "./engine/threatForecast";
import { CounterModule } from "./engine/factors/counterModule";
import { CompFitModule } from "./engine/factors/compFitModule";
import { SynergyModule } from "./engine/factors/synergyModule";
import { TeamCounterModule } from "./engine/factors/teamCounterModule";
import { SnapshotProScoringProvider } from "./engine/proScoring";
import { ipcChannels, type LcuStatus } from "./ipc";
import { LcuAdapter } from "./lcu/lcuAdapter";
import { installElectronSecurityGuards } from "./security/electronSecurity";
import {
  DEFAULT_APP_CONFIG,
  INTERNAL_DATA_CONFIG,
  isWeightOnlyPatch,
  type AppConfig,
  type AppConfigPatch,
} from "../shared/config";
import type {
  AnticipatedThreat,
  DraftSimulationState,
  DraftState,
  DraftTarget,
  RecommendationUpdate,
  Role,
  SimulationCommand,
} from "../shared/types";
import type { ProDataStatus } from "../shared/proData";
import type { ChampionAttributes } from "../shared/championAttributes";

const currentDirectory = __dirname;
const lcu = new LcuAdapter();
const DRAFT_PUSH_DEBOUNCE_MS = 50;
const DEFAULT_PRO_SNAPSHOT_URL =
  "https://github.com/wilsonpeng20070926-beep/draft-coach/releases/download/pro-data-latest/pro-snapshot.json.gz";

let mainWindow: BrowserWindow | null = null;
let catalog: ChampionCatalog | null = null;
let latestRawChampSelectSession: unknown = null;
let latestStatus: LcuStatus = {
  connection: "waiting",
  phase: null,
};
let draftPushTimer: NodeJS.Timeout | null = null;
let recommendationRunner: RecommendationRunner | null = null;
let simulationRecommendationRunner: RecommendationRunner | null = null;
let threatForecastProvider: ThreatForecastProvider | null = null;
let opggSource: OpggMcpSource | null = null;
let metaSource: MetaDataSource | null = null;
let proDataSource: ProDataSource | null = null;
let proAnalyticsProvider: ProAnalyticsProvider | null = null;
let draftStateRunId = 0;
let configStore: AppConfigStore | null = null;
let currentConfig: AppConfig = DEFAULT_APP_CONFIG;
let latestDraftState: DraftState | null = null;
let targetSelectionState: DraftTargetSelectionState = createDraftTargetSelectionState();
let latestRecommendationTargets: DraftTarget[] = [];
let simulationState: DraftSimulationState = createDraftSimulationState();
let latestSimulationForecasts: AnticipatedThreat[] = [];
let livePinnedThreats: AnticipatedThreat[] = [];
let latestLiveForecasts: AnticipatedThreat[] = [];
const liveRoleOverrides = new Map<number, Role>();
let liveThreatForecastRunId = 0;
let simulationRunId = 0;

function createWindow(): void {
  const developmentRendererUrl =
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL
      ? process.env.ELECTRON_RENDERER_URL
      : null;

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
      sandbox: true,
    },
  });

  installElectronSecurityGuards(mainWindow.webContents, {
    developmentRenderer: Boolean(developmentRendererUrl),
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    sendConfigChanged(currentConfig);
    sendLcuStatus(latestStatus);
    sendRecommendations(createEmptyRecommendationUpdate());
    sendSimulationState(simulationState);
    sendSimulationRecommendations(createEmptyRecommendationUpdate());

    if (process.env.DRAFT_COACH_SMOKE === "1") {
      void runSmokeCheck();
    }
  });

  if (developmentRendererUrl) {
    void mainWindow.loadURL(developmentRendererUrl);
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

function sendSimulationState(state: DraftSimulationState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.simulationState, state);
  });
}

function sendSimulationRecommendations(update: RecommendationUpdate): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.simulationRecommendations, update);
  });
}

function sendConfigChanged(config: AppConfig): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.configChanged, config);
  });
}

function sendProDataStatus(status: ProDataStatus): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.proDataStatus, status);
  });
}

function sendChampionCatalog(championCatalog: ChampionCatalog): void {
  const champions = championCatalog.all();
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(ipcChannels.catalogChanged, champions);
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

  const baseDraftState = applyDraftRoleOverrides(
    toDraftState(latestRawChampSelectSession, latestStatus.phase, catalog),
    liveRoleOverrides,
  );
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
  void opggSource.warmUp().catch((error: unknown) => {
    console.warn("[OP.GG] warm-up failed", toError(error).message);
  });
  const cachedSource = new CachedMetaDataSource(opggSource, {
    ttlMs: INTERNAL_DATA_CONFIG.opggCacheTtlMs,
    patchVersion: championCatalog.version(),
    cacheFile: join(app.getPath("userData"), "ranked-data-cache.json"),
  });
  const rankedSource = new ResilientMetaDataSource(
    cachedSource,
    new CatalogFallbackMetaDataSource(championCatalog),
  );
  metaSource = rankedSource;
  const attributeProvider = createChampionAttributeProvider(championCatalog.version());
  proAnalyticsProvider = new SnapshotProAnalyticsProvider(
    () => proDataSource?.getSnapshot() ?? null,
    () => ({
      currentPatch: currentProPatch(championCatalog.version()),
      getArchetypes: (championId) => {
        const champion = championCatalog.byId(championId);
        return champion
          ? deriveProArchetypes(attributeProvider.getAttributes(champion))
          : [];
      },
    }),
  );
  const proScoringProvider = new SnapshotProScoringProvider(
    proAnalyticsProvider,
    championCatalog,
    () => currentConfig.favoriteTeams,
  );
  const counterModule = new CounterModule(
    rankedSource,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const synergyModule = new SynergyModule(
    rankedSource,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const teamCounterModule = new TeamCounterModule(
    rankedSource,
    attributeProvider,
    () => currentConfig.region,
    () => currentConfig.rank,
    () => currentConfig.minChipConfidence,
  );
  const compFitModule = new CompFitModule(
    rankedSource,
    attributeProvider,
    () => currentConfig.region,
    () => currentConfig.rank,
  );
  const engine = new RecommendationEngine(
    rankedSource,
    [counterModule, teamCounterModule, synergyModule, compFitModule],
    createRecommendationOptions,
    (draft, target, options) =>
      buildAnalysisBackedTeamContext(
        draft,
        rankedSource,
        attributeProvider,
        {
          region: options.region,
          rank: options.rank,
        },
        target,
      ),
    (input) =>
      buildCandidatePool({
        ...input,
        getAttributes: attributeProvider.getAttributes,
      }),
    proScoringProvider,
  );

  recommendationRunner = new RecommendationRunner(engine);
  simulationRecommendationRunner = new RecommendationRunner(engine);
  threatForecastProvider = new RankedThreatForecastProvider(
    rankedSource,
    attributeProvider,
    proAnalyticsProvider,
  );
}

function deriveProArchetypes(attributes: ChampionAttributes): ProArchetype[] {
  const archetypes: ProArchetype[] = [];

  if (attributes.frontline >= 0.6) archetypes.push("frontline");
  if (attributes.engage >= 0.6) archetypes.push("engage");
  if (attributes.peel >= 0.6) archetypes.push("peel");
  if (attributes.poke >= 0.6) archetypes.push("poke");
  if (attributes.powerCurve === "late") archetypes.push("scaling");
  if (attributes.carryPotential >= 0.65) archetypes.push("carry");
  if (attributes.waveclear >= 0.65) archetypes.push("waveclear");
  if (attributes.range === "ranged" || attributes.range === "mixed") {
    archetypes.push("range");
  }

  return archetypes;
}

function currentProPatch(version: string): string | undefined {
  try {
    return deriveProPatchWindow(version)[0];
  } catch {
    return undefined;
  }
}

function initializeProDataSource(championCatalog: ChampionCatalog): void {
  const directFallbackEnabled =
    process.env.DRAFT_COACH_PRO_DIRECT_FALLBACK === "1";
  proDataSource = new StaticSnapshotProDataSource({
    cacheDirectory: join(app.getPath("userData"), "pro-data"),
    remoteUrl:
      process.env.DRAFT_COACH_PRO_SNAPSHOT_URL ?? DEFAULT_PRO_SNAPSHOT_URL,
    enabled: process.env.DRAFT_COACH_PRO_DATA_DISABLED !== "1",
    networkAllowed: process.env.DRAFT_COACH_NO_NETWORK !== "1",
    allowDirectFallback: directFallbackEnabled,
    directFallback: directFallbackEnabled
      ? () => fetchDirectProSnapshot(championCatalog)
      : undefined,
    onStatusChanged: sendProDataStatus,
  });

  void proDataSource.start().then(() => {
    if (proDataSource) {
      sendProDataStatus(proDataSource.getStatus());
    }
  });
}

async function fetchDirectProSnapshot(
  championCatalog: ChampionCatalog,
) {
  const patches = deriveProPatchWindow(championCatalog.version());
  const result = await new LeaguepediaCargoAdapter(championCatalog, {
    authentication: leaguepediaBotAuthenticationFromEnvironment(process.env) ?? undefined,
  }).fetchDrafts(patches);

  if (result.drafts.length === 0 || result.warnings.length > 0) {
    throw new Error(
      result.warnings.join("; ") || "Direct professional source returned no drafts",
    );
  }

  return buildProDataSnapshot(result.drafts, {
    generatedAt: new Date().toISOString(),
    warnings: result.warnings,
    complete: true,
  });
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
    proEvidenceEnabled: currentConfig.proEvidenceEnabled,
    proInfluence: currentConfig.proInfluence,
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

  if (draftState.phase !== "champSelect") {
    targetSelectionState = createDraftTargetSelectionState();
    latestRecommendationTargets = [];
    livePinnedThreats = [];
    latestLiveForecasts = [];
    sendRecommendations(createEmptyRecommendationUpdate());
    return;
  }

  const selection = reconcileDraftTargetSelection(draftState, targetSelectionState);
  targetSelectionState = selection.state;
  const targets = mergeRecommendationTargets(
    selection.automaticTargets,
    selection.selectedTarget,
  );
  const activeThreats = mergeAnticipatedThreats(
    livePinnedThreats,
    latestLiveForecasts,
  );
  latestRecommendationTargets = targets;

  if (
    !recommendationRunner ||
    !selection.selectedTarget ||
    targets.length === 0
  ) {
    sendRecommendations(
      createEmptyRecommendationUpdate(targets, selection.selectedTarget),
    );
    return;
  }

  sendRecommendations({
    recommendations: [],
    categories: [],
    evidenceBalance: emptyEvidenceBalance(),
    targets,
    target: selection.selectedTarget,
    evaluation: null,
    threats: activeThreats,
    loading: true,
    limitedDataNote: null,
    teamContext: null,
  });

  void recommendationRunner
    .recommendTargetsLatest(draftState, targets, activeThreats)
    .then((results) => {
      if (!results) {
        return;
      }

      sendSelectedTargetResult(
        targets,
        results,
        selection.selectedTarget!,
        activeThreats,
      );
    })
    .catch((error: unknown) => {
      console.error("[Recommendations]", toError(error).message);
      sendRecommendations({
        recommendations: [],
        categories: [],
        evidenceBalance: emptyEvidenceBalance(),
        targets,
        target: selection.selectedTarget,
        evaluation: null,
        threats: activeThreats,
        loading: false,
        limitedDataNote: "Recommendation data is unavailable right now.",
        teamContext: null,
      });
    });
}

function rerankLatestRecommendations(): void {
  const results = recommendationRunner?.rerankTargetsLatest() ?? [];
  const selection = latestDraftState
    ? reconcileDraftTargetSelection(latestDraftState, targetSelectionState)
    : null;

  if (selection?.selectedTarget && results.length === latestRecommendationTargets.length) {
    targetSelectionState = selection.state;
    sendSelectedTargetResult(
      latestRecommendationTargets,
      results,
      selection.selectedTarget,
      mergeAnticipatedThreats(livePinnedThreats, latestLiveForecasts),
    );
    return;
  }

  if (latestDraftState) {
    requestRecommendations(latestDraftState);
  }
}

function createEmptyRecommendationUpdate(
  targets: DraftTarget[] = [],
  target: DraftTarget | null = null,
): RecommendationUpdate {
  return {
    recommendations: [],
    categories: [],
    evidenceBalance: emptyEvidenceBalance(),
    targets,
    target,
    evaluation: null,
    threats: [],
    loading: false,
    limitedDataNote: null,
    teamContext: null,
  };
}

function mergeRecommendationTargets(
  automaticTargets: DraftTarget[],
  selectedTarget: DraftTarget | null,
): DraftTarget[] {
  const targets = [...automaticTargets];

  if (
    selectedTarget &&
    !targets.some((target) => draftTargetKey(target) === draftTargetKey(selectedTarget))
  ) {
    targets.push(selectedTarget);
  }

  return targets;
}

function sendSelectedTargetResult(
  targets: DraftTarget[],
  results: Array<{
    recommendations: RecommendationUpdate["recommendations"];
    categories: RecommendationUpdate["categories"];
    evidenceBalance: RecommendationUpdate["evidenceBalance"];
    evaluation: RecommendationUpdate["evaluation"];
    limitedDataNote: string | null;
    teamContext: Parameters<typeof createTeamContextProjection>[0];
  }>,
  selectedTarget: DraftTarget,
  threats: AnticipatedThreat[] = [],
): void {
  const selectedIndex = targets.findIndex(
    (target) => draftTargetKey(target) === draftTargetKey(selectedTarget),
  );
  const result = results[selectedIndex] ?? results[0];

  if (!result) {
    sendRecommendations(createEmptyRecommendationUpdate(targets, selectedTarget));
    return;
  }

  sendRecommendations({
    recommendations: result.recommendations,
    categories: result.categories,
    evidenceBalance: result.evidenceBalance,
    targets,
    target: selectedTarget,
    evaluation: result.evaluation,
    threats,
    loading: false,
    limitedDataNote: result.limitedDataNote,
    teamContext: createTeamContextProjection(result.teamContext),
  });
}

function mergeAnticipatedThreats(
  pinned: AnticipatedThreat[],
  forecasts: AnticipatedThreat[],
): AnticipatedThreat[] {
  const pinnedIds = new Set(pinned.map((threat) => threat.champion.id));

  return rankAnticipatedThreats([
    ...pinned,
    ...forecasts.filter((threat) => !pinnedIds.has(threat.champion.id)),
  ]);
}

function requestLiveThreatForecast(
  draft: DraftState,
  target: DraftTarget,
): void {
  const provider = threatForecastProvider;
  const runId = (liveThreatForecastRunId += 1);

  if (!provider) {
    sendRecommendations(
      createThreatPreparationUpdate(target, livePinnedThreats, false),
    );
    return;
  }

  sendRecommendations(
    createThreatPreparationUpdate(target, livePinnedThreats, true),
  );

  void provider
    .forecast(draft, target, {
      region: currentConfig.region,
      rank: currentConfig.rank,
      context: "live",
      favoriteTeams: currentConfig.favoriteTeams,
    })
    .then((forecasts) => {
      if (runId !== liveThreatForecastRunId) {
        return;
      }

      latestLiveForecasts = forecasts;
      sendRecommendations(
        createThreatPreparationUpdate(
          target,
          mergeAnticipatedThreats(livePinnedThreats, forecasts),
          false,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error("[ThreatForecast]", toError(error).message);

      if (runId === liveThreatForecastRunId) {
        sendRecommendations({
          ...createThreatPreparationUpdate(target, livePinnedThreats, false),
          limitedDataNote: "Ranked threat forecasting is unavailable right now.",
        });
      }
    });
}

function requestSimulationRecommendations(): void {
  const state = simulationState;
  const target = state.target;
  const runId = (simulationRunId += 1);

  if (!target) {
    sendSimulationRecommendations(createEmptyRecommendationUpdate());
    return;
  }

  if (target.side === "enemy" && target.purpose === "anticipate") {
    const provider = threatForecastProvider;
    sendSimulationRecommendations(
      createThreatPreparationUpdate(target, state.threats, Boolean(provider)),
    );

    if (!provider) {
      return;
    }

    void provider
      .forecast(state.draft, target, {
        region: currentConfig.region,
        rank: currentConfig.rank,
        context: "simulator",
        favoriteTeams: currentConfig.favoriteTeams,
      })
      .then((forecasts) => {
        if (runId !== simulationRunId) {
          return;
        }

        latestSimulationForecasts = forecasts;
        sendSimulationRecommendations(
          createThreatPreparationUpdate(
            target,
            mergeAnticipatedThreats(state.threats, forecasts),
            false,
          ),
        );
      })
      .catch((error: unknown) => {
        console.error("[SimulationForecast]", toError(error).message);

        if (runId === simulationRunId) {
          sendSimulationRecommendations({
            ...createThreatPreparationUpdate(target, state.threats, false),
            limitedDataNote: "Ranked threat forecasting is unavailable right now.",
          });
        }
      });
    return;
  }

  const runner = simulationRecommendationRunner;
  const threats = mergeAnticipatedThreats(
    state.threats,
    latestSimulationForecasts,
  );

  if (!runner) {
    sendSimulationRecommendations(
      createEmptyRecommendationUpdate([target], target),
    );
    return;
  }

  sendSimulationRecommendations({
    recommendations: [],
    categories: [],
    evidenceBalance: emptyEvidenceBalance(),
    targets: [target],
    target,
    evaluation: null,
    threats,
    loading: true,
    limitedDataNote: null,
    teamContext: null,
  });

  void runner
    .recommendLatest(state.draft, target, threats)
    .then((result) => {
      if (!result || runId !== simulationRunId) {
        return;
      }

      sendSimulationRecommendations({
        recommendations: result.recommendations,
        categories: result.categories,
        evidenceBalance: result.evidenceBalance,
        targets: [target],
        target,
        evaluation: result.evaluation,
        threats,
        loading: false,
        limitedDataNote: result.limitedDataNote,
        teamContext: createTeamContextProjection(result.teamContext),
      });
    })
    .catch((error: unknown) => {
      console.error("[SimulationRecommendations]", toError(error).message);

      if (runId === simulationRunId) {
        sendSimulationRecommendations({
          ...createEmptyRecommendationUpdate([target], target),
          threats,
          limitedDataNote: "Simulation recommendations are unavailable right now.",
        });
      }
    });
}

function createThreatPreparationUpdate(
  target: DraftTarget,
  threats: AnticipatedThreat[],
  loading: boolean,
): RecommendationUpdate {
  return {
    recommendations: [],
    categories: [],
    evidenceBalance: emptyEvidenceBalance(),
    targets: [target],
    target,
    evaluation: null,
    threats,
    loading,
    limitedDataNote: loading
      ? null
      : "Hypothetical ranked forecast — this is not a known enemy pick.",
    teamContext: null,
  };
}

function emptyEvidenceBalance(): RecommendationUpdate["evidenceBalance"] {
  return {
    rankedPercent: 100,
    proPercent: 0,
    rankedMagnitude: 0,
    proMagnitude: 0,
  };
}

function startLcu(championCatalog: ChampionCatalog): void {
  catalog = championCatalog;
  sendChampionCatalog(championCatalog);
  sendLcuStatus({ connection: "waiting", phase: null });
  const draftState = createEmptyDraftState(null);
  sendDraftState(draftState);
  requestRecommendations(draftState);

  lcu.on("connected", () => {
    sendLcuStatus({ connection: "connected", phase: latestStatus.phase });
  });

  lcu.on("disconnected", () => {
    latestRawChampSelectSession = null;
    liveRoleOverrides.clear();
    sendLcuStatus({ connection: "waiting", phase: null });
    const draftState = createEmptyDraftState(null);
    sendDraftState(draftState);
    requestRecommendations(draftState);
  });

  lcu.on("phaseChanged", (phase) => {
    if (phase !== "ChampSelect") {
      liveRoleOverrides.clear();
    }

    sendLcuStatus({ connection: "connected", phase });
    scheduleDraftStatePush();
  });

  lcu.on("champSelectSession", (session) => {
    latestRawChampSelectSession = session;
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
ipcMain.handle(ipcChannels.proDataGetStatus, () =>
  proDataSource?.getStatus() ?? emptyProDataStatus(),
);
ipcMain.handle(ipcChannels.proDataRefresh, async () => {
  await proDataSource?.refresh("manual");
  const status = proDataSource?.getStatus() ?? emptyProDataStatus();
  sendProDataStatus(status);
  return status;
});
ipcMain.handle(ipcChannels.proDataImport, async () => {
  const selection = await dialog.showOpenDialog({
    title: "Import professional data",
    properties: ["openFile"],
    filters: [
      {
        name: "Professional data",
        extensions: ["csv", "json", "gz"],
      },
    ],
  });

  if (selection.canceled || !selection.filePaths[0]) {
    return proDataSource?.getStatus() ?? emptyProDataStatus();
  }

  try {
    const inputPath = selection.filePaths[0];

    if (extname(inputPath).toLowerCase() === ".csv") {
      if (!catalog || !proDataSource) {
        throw new Error("Champion catalog is not ready");
      }

      await catalog.refresh().catch((error: unknown) => {
        console.warn(
          "[ProData] Data Dragon refresh failed; using cached catalog",
          toError(error).message,
        );
      });
      const imported = await new OracleElixirCsvAdapter(catalog).importFile(
        inputPath,
        deriveProPatchWindow(catalog.version()),
      );
      const snapshot = buildProDataSnapshot(imported.drafts, {
        generatedAt: new Date().toISOString(),
        source: "Oracle's Elixir (local noncommercial import)",
        sourceUrl: "https://oracleselixir.com/tools/downloads",
        attribution: "Oracle's Elixir / Tim Sevenhuysen",
        warnings: imported.warnings,
        complete: true,
      });
      await proDataSource.installSnapshot(snapshot);
    } else {
      const bytes = await readFile(inputPath);
      await proDataSource?.importSnapshot(bytes);
    }
  } catch (error) {
    proDataSource?.reportImportError(toError(error).message);
  }

  const status = proDataSource?.getStatus() ?? emptyProDataStatus();
  sendProDataStatus(status);
  return status;
});
ipcMain.handle(ipcChannels.catalogGet, () => catalog?.all() ?? []);
ipcMain.handle(ipcChannels.simulationGet, () => simulationState);
ipcMain.handle(
  ipcChannels.simulationCommand,
  (_event, command: SimulationCommand) => {
    if (!catalog || !command || typeof command !== "object") {
      return simulationState;
    }

    if (
      command.type === "assignRole" ||
      command.type === "setPick" ||
      command.type === "clearPick" ||
      command.type === "ban" ||
      command.type === "unban" ||
      command.type === "undo" ||
      command.type === "reset"
    ) {
      latestSimulationForecasts = [];
    }

    simulationState = applySimulationCommand(simulationState, command, catalog);
    sendSimulationState(simulationState);
    requestSimulationRecommendations();
    return simulationState;
  },
);
ipcMain.handle(ipcChannels.draftTargetSet, (_event, cellId: unknown) => {
  if (
    !latestDraftState ||
    typeof cellId !== "number" ||
    !Number.isInteger(cellId)
  ) {
    return;
  }

  const selection = selectManualDraftTarget(
    latestDraftState,
    targetSelectionState,
    cellId,
  );
  liveThreatForecastRunId += 1;
  targetSelectionState = selection.state;
  requestRecommendations(latestDraftState);
});
ipcMain.handle(
  ipcChannels.draftRoleSet,
  (_event, cellId: unknown, role: unknown) => {
    if (
      !latestDraftState ||
      typeof cellId !== "number" ||
      !Number.isInteger(cellId) ||
      (role !== null && !isRole(role)) ||
      !latestDraftState.allies.some((ally) => ally.cellId === cellId)
    ) {
      return;
    }

    if (role === null) {
      liveRoleOverrides.delete(cellId);
    } else {
      liveRoleOverrides.set(cellId, role);
    }

    scheduleDraftStatePush();
  },
);
ipcMain.handle(
  ipcChannels.draftThreatTargetSet,
  (_event, cellId: unknown, role: unknown) => {
    if (
      !latestDraftState ||
      typeof cellId !== "number" ||
      !Number.isInteger(cellId) ||
      !isRole(role) ||
      !latestDraftState.enemies.some((enemy) => enemy.cellId === cellId)
    ) {
      return;
    }

    requestLiveThreatForecast(latestDraftState, {
      side: "enemy",
      cellId,
      role,
      source: "manual",
      purpose: "anticipate",
    });
  },
);
ipcMain.handle(
  ipcChannels.draftThreatPin,
  (_event, championId: unknown, role: unknown) => {
    const champion =
      catalog && typeof championId === "number" ? catalog.byId(championId) : null;

    if (!champion || (role !== null && !isRole(role))) {
      return;
    }

    livePinnedThreats = mergeAnticipatedThreats(
      [
        ...livePinnedThreats.filter((threat) => threat.champion.id !== champion.id),
        {
          champion,
          role,
          source: "manual",
          confidence: 0.7,
          pinned: true,
          evidence: ["Pinned hypothetical threat"],
        },
      ],
      [],
    );

    if (latestDraftState) {
      requestRecommendations(latestDraftState);
    }
  },
);
ipcMain.handle(ipcChannels.draftThreatRemove, (_event, championId: unknown) => {
  if (typeof championId !== "number") {
    return;
  }

  livePinnedThreats = livePinnedThreats.filter(
    (threat) => threat.champion.id !== championId,
  );

  if (latestDraftState) {
    requestRecommendations(latestDraftState);
  }
});
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

  requestSimulationRecommendations();

  return config;
});

app.whenReady().then(async () => {
  configStore = createAppConfigStore(app.getPath("userData"));
  currentConfig = await configStore.load();
  createWindow();
  const championCatalog = await initializeCatalog();
  initializeProDataSource(championCatalog);
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
  proDataSource?.stop();
  void opggSource?.close();
});

function emptyProDataStatus(): ProDataStatus {
  return {
    state: "ranked-only",
    source: null,
    generatedAt: null,
    gameCount: 0,
    lastError: null,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRole(value: unknown): value is Role {
  return (
    value === "top" ||
    value === "jungle" ||
    value === "middle" ||
    value === "bottom" ||
    value === "utility"
  );
}
