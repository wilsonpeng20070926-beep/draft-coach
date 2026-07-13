import { useEffect, useMemo, useState } from "react";
import { CompositionPanel } from "./components/CompositionPanel";
import DraftBoard from "./components/DraftBoard";
import { RecommendationList } from "./components/RecommendationList";
import { SettingsPanel } from "./components/SettingsPanel";
import { SimulationPanel } from "./components/SimulationPanel";
import { ProDataStatusPanel } from "./components/ProDataStatusPanel";
import { ModeTabs, type DraftMode } from "./components/ModeTabs";
import type { LcuStatus } from "../main/ipc";
import { DEFAULT_APP_CONFIG, type AppConfig, type AppConfigPatch } from "../shared/config";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftSimulationState,
  DraftState,
  RecommendationUpdate,
  SimulationCommand,
} from "../shared/types";
import type { ProDataStatus } from "../shared/proData";

const initialStatus: LcuStatus = {
  connection: "waiting",
  phase: null,
};

const initialRecommendationUpdate: RecommendationUpdate = {
  recommendations: [],
  categories: [],
  evidenceBalance: {
    rankedPercent: 100,
    proPercent: 0,
    rankedMagnitude: 0,
    proMagnitude: 0,
  },
  targets: [],
  target: null,
  evaluation: null,
  threats: [],
  loading: false,
  limitedDataNote: null,
  teamContext: null,
};

function App(): JSX.Element {
  const [pong, setPong] = useState("...");
  const [status, setStatus] = useState<LcuStatus>(initialStatus);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [recommendationUpdate, setRecommendationUpdate] = useState<RecommendationUpdate>(
    initialRecommendationUpdate,
  );
  const [mode, setMode] = useState<DraftMode>("live");
  const [champions, setChampions] = useState<ChampionRef[]>([]);
  const [simulationState, setSimulationState] = useState<DraftSimulationState | null>(null);
  const [simulationUpdate, setSimulationUpdate] = useState<RecommendationUpdate>(
    initialRecommendationUpdate,
  );
  const [proDataStatus, setProDataStatus] = useState<ProDataStatus | null>(null);

  useEffect(() => {
    void window.api.ping().then(setPong).catch(() => setPong("IPC unavailable"));
    void window.api.getConfig().then(setConfig).catch(() => setConfig(DEFAULT_APP_CONFIG));
    void window.api.getChampions().then(setChampions).catch(() => setChampions([]));
    void window.api.getSimulationState().then(setSimulationState).catch(() => undefined);
    void window.api.getProDataStatus().then(setProDataStatus).catch(() => undefined);

    const removeStatusListener = window.api.onLcuStatus(setStatus);
    const removeDraftStateListener = window.api.onDraftState(setDraftState);
    const removeRecommendationListener = window.api.onRecommendations(setRecommendationUpdate);
    const removeConfigListener = window.api.onConfigChanged(setConfig);
    const removeChampionListener = window.api.onChampions(setChampions);
    const removeSimulationStateListener = window.api.onSimulationState(setSimulationState);
    const removeSimulationRecommendationListener =
      window.api.onSimulationRecommendations(setSimulationUpdate);
    const removeProDataStatusListener = window.api.onProDataStatus(setProDataStatus);

    return () => {
      removeStatusListener();
      removeDraftStateListener();
      removeRecommendationListener();
      removeConfigListener();
      removeChampionListener();
      removeSimulationStateListener();
      removeSimulationRecommendationListener();
      removeProDataStatusListener();
    };
  }, []);

  const headline = getHeadline(status);
  const isConnected = status.connection === "connected";
  const isChampSelect = isConnected && status.phase === "ChampSelect";
  const statusLabel = useMemo(() => getStatusLabel(status), [status]);
  const updateConfig = (patch: AppConfigPatch): void => {
    setConfigSaving(true);
    void window.api
      .setConfig(patch)
      .then(setConfig)
      .finally(() => setConfigSaving(false));
  };
  const applySimulationCommand = (command: SimulationCommand): void => {
    void window.api.applySimulationCommand(command).then(setSimulationState);
  };
  const pinSimulationThreat = (threat: AnticipatedThreat): void => {
    applySimulationCommand({
      type: "pinThreat",
      championId: threat.champion.id,
      role: threat.role,
      source: "simulation",
      confidence: threat.confidence,
    });
  };
  const refreshProData = (): void => {
    void window.api.refreshProData().then(setProDataStatus);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Draft Coach</p>
          <h1>{headline}</h1>
          <p className="subtle">{statusLabel}</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon />
          </button>
          <div className="status-light" data-active={isConnected} />
        </div>
      </header>

      <section className="status-panel" aria-label="connection status">
        <div className="row">
          <span>IPC</span>
          <strong>{pong}</strong>
        </div>
        <div className="row">
          <span>Gameflow</span>
          <strong>{status.phase ?? "Unknown"}</strong>
        </div>
      </section>

      <ModeTabs mode={mode} onChange={setMode} />

      <ProDataStatusPanel status={proDataStatus} onRefresh={refreshProData} />

      <div id="draft-mode-panel" role="tabpanel">
      {mode === "simulation" && simulationState ? (
        <>
          <SimulationPanel
            state={simulationState}
            champions={champions}
            favoriteTeams={config.favoriteTeams}
            onCommand={applySimulationCommand}
          />
          <RecommendationList
            update={simulationUpdate}
            onSelectTarget={() => undefined}
            onPinThreat={pinSimulationThreat}
            onRemoveThreat={(threat) =>
              applySimulationCommand({
                type: "removeThreat",
                championId: threat.champion.id,
              })
            }
          />
          <CompositionPanel context={simulationUpdate.teamContext} />
        </>
      ) : mode === "live" && isChampSelect && draftState ? (
        <>
          <RecommendationList
            update={recommendationUpdate}
            onSelectTarget={(cellId) => void window.api.setDraftTarget(cellId)}
            onPinThreat={(threat) =>
              void window.api.pinLiveThreat(threat.champion.id, threat.role)
            }
            onRemoveThreat={(threat) =>
              void window.api.removeLiveThreat(threat.champion.id)
            }
          />
          <CompositionPanel context={recommendationUpdate.teamContext} />
          <DraftBoard
            draftState={draftState}
            target={recommendationUpdate.target}
            onSelectAlly={(cellId) => void window.api.setDraftTarget(cellId)}
            onSelectEnemy={(cellId, role) =>
              void window.api.setDraftThreatTarget(cellId, role)
            }
          />
        </>
      ) : (
        <section className="idle-view">
          <p>
            {mode === "simulation"
              ? "Loading the offline simulator."
              : isConnected
              ? "Open a practice tool or custom draft to see the live board."
              : "Waiting for the League client. Reconnect happens automatically."}
          </p>
        </section>
      )}
      </div>

      {settingsOpen ? (
        <SettingsPanel
          config={config}
          saving={configSaving}
          onChange={updateConfig}
          onClose={() => setSettingsOpen(false)}
          proDataStatus={proDataStatus}
          onRefreshProData={refreshProData}
        />
      ) : null}
    </main>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.3 7.3 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.3 7.3 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.3 7.3 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.3 7.3 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
    </svg>
  );
}

function getHeadline(status: LcuStatus): string {
  if (status.connection !== "connected") {
    return "Waiting for League client...";
  }

  if (status.phase === "ChampSelect") {
    return "In champ select";
  }

  return "Connected - not in champ select";
}

function getStatusLabel(status: LcuStatus): string {
  if (status.connection !== "connected") {
    return "League client not detected";
  }

  if (status.phase === "ChampSelect") {
    return "Live draft board";
  }

  return "Tracking gameflow";
}

export default App;
