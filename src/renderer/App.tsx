import { useEffect, useMemo, useState } from "react";
import { CompositionPanel } from "./components/CompositionPanel";
import DraftBoard from "./components/DraftBoard";
import { RecommendationList } from "./components/RecommendationList";
import { SettingsPanel } from "./components/SettingsPanel";
import type { LcuStatus } from "../main/ipc";
import { DEFAULT_APP_CONFIG, type AppConfig, type AppConfigPatch } from "../shared/config";
import type { DraftState, RecommendationUpdate } from "../shared/types";

const initialStatus: LcuStatus = {
  connection: "waiting",
  phase: null,
};

const initialRecommendationUpdate: RecommendationUpdate = {
  recommendations: [],
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

  useEffect(() => {
    void window.api.ping().then(setPong).catch(() => setPong("IPC unavailable"));
    void window.api.getConfig().then(setConfig).catch(() => setConfig(DEFAULT_APP_CONFIG));

    const removeStatusListener = window.api.onLcuStatus(setStatus);
    const removeDraftStateListener = window.api.onDraftState(setDraftState);
    const removeRecommendationListener = window.api.onRecommendations(setRecommendationUpdate);
    const removeConfigListener = window.api.onConfigChanged(setConfig);

    return () => {
      removeStatusListener();
      removeDraftStateListener();
      removeRecommendationListener();
      removeConfigListener();
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

      {isChampSelect && draftState ? (
        <>
          <RecommendationList update={recommendationUpdate} />
          <CompositionPanel context={recommendationUpdate.teamContext} />
          <DraftBoard draftState={draftState} />
        </>
      ) : (
        <section className="idle-view">
          <p>
            {isConnected
              ? "Open a practice tool or custom draft to see the live board."
              : "Waiting for the League client. Reconnect happens automatically."}
          </p>
        </section>
      )}

      {settingsOpen ? (
        <SettingsPanel
          config={config}
          saving={configSaving}
          onChange={updateConfig}
          onClose={() => setSettingsOpen(false)}
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
