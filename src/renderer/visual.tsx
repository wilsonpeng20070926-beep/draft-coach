import React from "react";
import ReactDOM from "react-dom/client";
import { DEFAULT_APP_CONFIG } from "../shared/config";
import type { ProEvidenceRecord, ProDataStatus } from "../shared/proData";
import type {
  ChampionRef,
  DraftSimulationState,
  DraftState,
  Recommendation,
  RecommendationUpdate,
} from "../shared/types";
import DraftBoard from "./components/DraftBoard";
import { ProDataStatusPanel } from "./components/ProDataStatusPanel";
import { RecommendationList } from "./components/RecommendationList";
import { SettingsPanel } from "./components/SettingsPanel";
import { SimulationPanel } from "./components/SimulationPanel";
import { ModeTabs, type DraftMode } from "./components/ModeTabs";
import "./styles.css";

const longChampion = champion(
  1,
  "Aurelion Sol With An Extremely Long Tournament Display Name",
);
const partner = champion(2, "Bard");
const enemy = champion(3, "Cho'Gath");
const alternative = champion(4, "Orianna");
const evidence: ProEvidenceRecord = {
  kind: "priority",
  text: "MSI · patch 26.13 · 7 picks / 2 bans",
  statistics: { picks: 7, bans: 2, opportunities: 12, rate: 0.675 },
  patches: ["26.13", "26.12"],
  competitions: ["MSI 2026", "2026 LCK Split 1"],
  teams: ["Bilibili Gaming With A Very Long Display Name"],
  effectiveSample: 7.9,
  confidence: 0.72,
  ageDays: 1,
  material: true,
};
const primary = recommendation(longChampion, 0.78, evidence, "High risk");
const second = recommendation(alternative, 0.72, evidence, null);
const recommendations = [primary, second];
const update: RecommendationUpdate = {
  recommendations,
  categories: [
    { key: "overall", label: "Best overall", recommendations },
    { key: "lane", label: "Best lane matchup", recommendations: [primary] },
    { key: "synergy", label: "Best synergy", recommendations: [primary, second] },
    { key: "pro", label: "Pro-inspired", recommendations: [primary] },
    { key: "risk", label: "Avoid / High risk", recommendations: [primary] },
  ],
  evidenceBalance: {
    rankedPercent: 65,
    proPercent: 35,
    rankedMagnitude: 0.26,
    proMagnitude: 0.14,
  },
  targets: [
    { side: "ally", cellId: 0, role: "middle", source: "automatic", purpose: "recommend" },
    { side: "ally", cellId: 1, role: "utility", source: "automatic", purpose: "recommend" },
  ],
  target: { side: "ally", cellId: 0, role: "middle", source: "automatic", purpose: "recommend" },
  evaluation: {
    champion: longChampion,
    state: "hovering",
    total: 0.78,
    strengths: ["Strong current professional priority"],
    risks: ["High risk into hard engage"],
    teamFit: ["Pairs with Bard"],
    evidence: primary.contributions,
  },
  threats: [],
  loading: false,
  limitedDataNote: null,
  teamContext: null,
};
const draftState: DraftState = {
  phase: "champSelect",
  allies: [
    player(0, "ally", "middle", longChampion, "hovering", true),
    player(1, "ally", "utility", partner, "locked", false),
  ],
  enemies: [player(5, "enemy", "middle", enemy, "locked", false)],
  bans: [champion(5, "Twisted Fate With A Long Skin-Like Name")],
  pickActions: [],
  activeAllyPickCellIds: [0, 1],
  localPlayer: null,
};
const proStatus: ProDataStatus = {
  state: "stale",
  source: "Leaguepedia Cargo Snapshot With Long Attribution",
  generatedAt: "2026-07-09T00:00:00.000Z",
  gameCount: 384,
  lastError: null,
};
const simulation: DraftSimulationState = {
  draft: {
    ...draftState,
    allies: Array.from({ length: 5 }, (_, index) =>
      player(index, "ally", index === 0 ? "top" : "middle", index === 0 ? longChampion : null, index === 0 ? "hovering" : "empty", index === 0),
    ),
    enemies: Array.from({ length: 5 }, (_, index) =>
      player(index + 5, "enemy", index === 0 ? "top" : "utility", index === 0 ? enemy : null, index === 0 ? "locked" : "empty", false),
    ),
    bans: [partner],
  },
  target: { side: "ally", cellId: 0, role: "top", source: "simulation", purpose: "recommend" },
  threats: [],
  history: [{ draft: draftState, target: null, threats: [] }],
};

function VisualFixture(): JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "recommendations";
  const [reranking, setReranking] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [fixtureMode, setFixtureMode] = React.useState<DraftMode>(
    view === "simulator" ? "simulation" : "live",
  );
  const displayedUpdate = reranking
    ? {
        ...update,
        recommendations: [],
        categories: [],
        evaluation: null,
        loading: true,
        evidenceBalance: {
          rankedPercent: 100,
          proPercent: 0,
          rankedMagnitude: 0,
          proMagnitude: 0,
        },
      }
    : update;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Draft Coach · Visual QA</p>
          <h1>In champ select</h1>
          <p className="subtle">Compact fixture at the current viewport</p>
        </div>
      </header>
      <ModeTabs mode={fixtureMode} onChange={setFixtureMode} />
      <ProDataStatusPanel status={proStatus} onRefresh={() => undefined} />
      <div id="draft-mode-panel" role="tabpanel">
        {view === "recommendations" && fixtureMode === "live" ? (
          <button
            className="visual-fixture-toggle"
            type="button"
            onClick={() => setReranking((value) => !value)}
          >
            Toggle rerank fixture
          </button>
        ) : null}
        {fixtureMode === "simulation" ? (
          <SimulationPanel
            state={simulation}
            champions={[longChampion, partner, enemy, alternative]}
            favoriteTeams={["Bilibili Gaming With A Very Long Display Name", "T1"]}
            onCommand={() => undefined}
          />
        ) : (
          <>
            <RecommendationList update={displayedUpdate} onSelectTarget={() => undefined} />
            <DraftBoard
              draftState={draftState}
              target={update.target}
              onSelectAlly={() => undefined}
              onSelectEnemy={() => undefined}
            />
          </>
        )}
      </div>
      {view === "settings" && settingsOpen ? (
        <SettingsPanel
          config={{
            ...DEFAULT_APP_CONFIG,
            favoriteTeams: ["Bilibili Gaming With A Very Long Display Name", "T1"],
          }}
          saving={false}
          proDataStatus={proStatus}
          onRefreshProData={() => undefined}
          onChange={() => undefined}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

function recommendation(
  selectedChampion: ChampionRef,
  total: number,
  proEvidence: ProEvidenceRecord,
  risk: Recommendation["risk"] extends infer _ ? "High risk" | null : never,
): Recommendation {
  return {
    champion: selectedChampion,
    total,
    contributions: [
      {
        factor: "meta",
        score: 0.66,
        reasons: ["Meta: 52% WR · 8.4% pick · tier 2"],
        effectiveDelta: 0.09,
        source: "ranked",
      },
      {
        factor: "proPriority",
        score: 0.56,
        reasons: [proEvidence.text],
        delta: 0.06,
        effectiveDelta: 0.04,
        confidence: 0.72,
        source: "pro",
        proEvidence: [proEvidence],
        reasonChips: [{
          kind: "pro",
          text: proEvidence.text,
          polarity: "positive",
          strength: 0.8,
          confidence: 0.72,
        }],
      },
    ],
    risk: risk
      ? {
          label: risk,
          confidence: 0.66,
          reasons: ["Vulnerable to the revealed hard engage"],
          traceableFactors: ["teamCounter"],
        }
      : null,
  };
}

function champion(id: number, name: string): ChampionRef {
  return { id, name, slug: name.replace(/\W/g, ""), tags: [], iconUrl: "" };
}

function player(
  cellId: number,
  side: "ally" | "enemy",
  role: "top" | "middle" | "utility",
  selectedChampion: ChampionRef | null,
  pickState: "empty" | "hovering" | "locked",
  isLocalPlayer: boolean,
) {
  return {
    cellId,
    side,
    role,
    champion: selectedChampion,
    pickState,
    isLocalPlayer,
    roleSource: "assigned" as const,
    roleConfidence: 1,
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VisualFixture />
  </React.StrictMode>,
);
