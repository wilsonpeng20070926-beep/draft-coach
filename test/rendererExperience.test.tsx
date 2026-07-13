import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_CONFIG } from "../src/shared/config";
import type { ProDataStatus, ProEvidenceRecord } from "../src/shared/proData";
import type {
  ChampionRef,
  DraftSimulationState,
  DraftState,
  Recommendation,
  RecommendationUpdate,
} from "../src/shared/types";
import DraftBoard from "../src/renderer/components/DraftBoard";
import {
  RecommendationList,
  nextTabIndex,
} from "../src/renderer/components/RecommendationList";
import {
  ProDataStatusPanel,
  formatStatusAge,
} from "../src/renderer/components/ProDataStatusPanel";
import {
  SettingsPanel,
  parseFavoriteTeams,
} from "../src/renderer/components/SettingsPanel";
import { formatExactProEvidence } from "../src/renderer/components/RecommendationCard";
import { SimulationPanel } from "../src/renderer/components/SimulationPanel";
import {
  ModeTabs,
  nextModeForKey,
} from "../src/renderer/components/ModeTabs";

const longName = "Aurelion Sol With A Very Long Competitive Display Name";
const aurelion = champion(1, longName);
const bard = champion(2, "Bard");
const evidence = proEvidence();
const primary = recommendation(aurelion, "High risk");
const secondary = recommendation(bard, null);

describe("Phase 6 renderer experience", () => {
  it("renders selected target tabs, compact overlapping categories, balance, hover evaluation, and alternatives", () => {
    const html = renderToStaticMarkup(
      <RecommendationList
        update={update("hovering")}
        onSelectTarget={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="active allied pickers"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-label="recommendation categories"');
    expect(html).toContain("Best overall");
    expect(html).toContain("Best synergy");
    expect(html).toContain("65% ranked / 35% pro evidence");
    expect(html).toContain("Evaluate hover");
    expect(html).toContain(longName);
    expect(html).toContain("Bard");
  });

  it("renders the locked transition as a collapsed summary with expandable evidence control", () => {
    const html = renderToStaticMarkup(
      <RecommendationList
        update={update("locked")}
        onSelectTarget={() => undefined}
      />,
    );

    expect(html).toContain("Locked pick");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show evidence");
    expect(html).toContain("Strengths");
    expect(html).toContain("Risks");
    expect(html).toContain("Team fit");
  });

  it("labels hypothetical threat pin/remove actions without presenting known picks", () => {
    const threatUpdate: RecommendationUpdate = {
      ...emptyUpdate(),
      target: {
        side: "enemy",
        cellId: 5,
        role: "top",
        source: "manual",
        purpose: "anticipate",
      },
      targets: [],
      threats: [{
        champion: aurelion,
        role: "top",
        source: "forecast",
        confidence: 0.45,
        evidence: ["Hypothetical professional role priority"],
      }],
    };
    const html = renderToStaticMarkup(
      <RecommendationList
        update={threatUpdate}
        onSelectTarget={() => undefined}
        onPinThreat={() => undefined}
      />,
    );
    const pinnedHtml = renderToStaticMarkup(
      <RecommendationList
        update={{
          ...threatUpdate,
          threats: threatUpdate.threats.map((threat) => ({ ...threat, pinned: true })),
        }}
        onSelectTarget={() => undefined}
        onRemoveThreat={() => undefined}
      />,
    );

    expect(html).toContain("Prepare to counter");
    expect(html).toContain("Hypothetical professional role priority");
    expect(html).toContain(`aria-label="Pin hypothetical ${longName} threat"`);
    expect(pinnedHtml).toContain(`aria-label="Remove hypothetical ${longName} threat"`);
  });

  it("marks the active draft target and exposes ally/enemy action labels", () => {
    const html = renderToStaticMarkup(
      <DraftBoard
        draftState={draft()}
        target={{
          side: "ally",
          cellId: 0,
          role: "middle",
          source: "automatic",
          purpose: "recommend",
        }}
        onSelectAlly={() => undefined}
        onSelectEnemy={() => undefined}
      />,
    );

    expect(html).toContain('data-target="true"');
    expect(html).toContain('aria-label="Recommend for middle ally"');
    expect(html).toContain('aria-label="Prepare to counter middle enemy"');
  });

  it("renders stale and ranked-only professional states as visible notices", () => {
    const stale = renderToStaticMarkup(
      <ProDataStatusPanel status={status("stale")} onRefresh={() => undefined} />,
    );
    const rankedOnly = renderToStaticMarkup(
      <ProDataStatusPanel status={status("ranked-only")} />,
    );

    expect(stale).toContain("Professional data is stale");
    expect(stale).toContain("Refresh professional data");
    expect(rankedOnly).toContain("Ranked-only recommendations");
    expect(formatStatusAge("2026-07-10T22:00:00.000Z", new Date("2026-07-11T00:00:00.000Z"))).toBe(
      "Updated 2h ago",
    );
  });

  it("renders accessible professional settings, favorites, refresh, and advanced controls", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        config={{
          ...DEFAULT_APP_CONFIG,
          favoriteTeams: ["Bilibili Gaming", "T1"],
        }}
        saving={false}
        proDataStatus={status("ready")}
        onRefreshProData={() => undefined}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Use professional data");
    expect(html).toContain("Pro influence");
    expect(html).toContain("Bilibili Gaming, T1");
    expect(html).toContain("Advanced ranked balance");
    expect(html).toContain("Refresh professional data");
  });

  it("labels simulator targets uniquely and exposes the selected target", () => {
    const state: DraftSimulationState = {
      draft: draft(),
      target: {
        side: "ally",
        cellId: 0,
        role: "middle",
        source: "simulation",
        purpose: "recommend",
      },
      threats: [],
      history: [],
    };
    const html = renderToStaticMarkup(
      <SimulationPanel
        state={state}
        champions={[aurelion, bard]}
        favoriteTeams={["Bilibili Gaming"]}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Recommend for allies slot 0"');
    expect(html).toContain('aria-label="Prepare to counter enemies slot 5"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Favorite-team strategy · Bilibili Gaming");
  });

  it("supports deterministic keyboard tab navigation and favorite parsing", () => {
    expect(nextTabIndex(0, 4, "ArrowRight")).toBe(1);
    expect(nextTabIndex(0, 4, "ArrowLeft")).toBe(3);
    expect(nextTabIndex(2, 4, "Home")).toBe(0);
    expect(nextTabIndex(2, 4, "End")).toBe(3);
    expect(nextTabIndex(2, 4, "Enter")).toBeNull();
    expect(nextModeForKey("live", "ArrowRight")).toBe("simulation");
    expect(nextModeForKey("simulation", "ArrowLeft")).toBe("live");
    expect(nextModeForKey("live", "Enter")).toBeNull();
    expect(parseFavoriteTeams(" T1, Bilibili Gaming, T1, ")).toEqual([
      "Bilibili Gaming",
      "T1",
    ]);
  });

  it("renders Live and Simulator as a roving keyboard tablist", () => {
    const html = renderToStaticMarkup(
      <ModeTabs mode="live" onChange={() => undefined} />,
    );

    expect(html).toContain('aria-label="draft mode"');
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Simulator");
  });

  it("formats exact professional evidence for expansion and specific risk language", () => {
    expect(formatExactProEvidence(evidence)).toBe(
      "effective n 7.90 · 72% confidence · 1d old · patches 26.13, 26.12 · MSI 2026 · teams Bilibili Gaming",
    );
    const html = renderToStaticMarkup(
      <RecommendationList update={update("hovering")} onSelectTarget={() => undefined} />,
    );
    expect(html).toContain("High risk");
    expect(html).toContain("Vulnerable to the revealed hard engage");
    expect(html).not.toContain(">Avoid<");
  });
});

function update(state: "hovering" | "locked"): RecommendationUpdate {
  return {
    recommendations: state === "locked" ? [] : [primary, secondary],
    categories: state === "locked"
      ? []
      : [
          { key: "overall", label: "Best overall", recommendations: [primary, secondary] },
          { key: "synergy", label: "Best synergy", recommendations: [primary] },
          { key: "pro", label: "Pro-inspired", recommendations: [primary] },
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
      champion: aurelion,
      state,
      total: primary.total,
      strengths: ["Strong current professional priority"],
      risks: ["Vulnerable to the revealed hard engage"],
      teamFit: ["Pairs with Bard"],
      evidence: primary.contributions,
    },
    threats: [],
    loading: false,
    limitedDataNote: null,
    teamContext: null,
  };
}

function emptyUpdate(): RecommendationUpdate {
  return {
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
}

function recommendation(
  selectedChampion: ChampionRef,
  risk: "High risk" | null,
): Recommendation {
  return {
    champion: selectedChampion,
    total: selectedChampion.id === 1 ? 0.78 : 0.71,
    contributions: [{
      factor: "proPriority",
      score: 0.56,
      reasons: [evidence.text],
      delta: 0.06,
      effectiveDelta: 0.04,
      confidence: 0.72,
      source: "pro",
      proEvidence: [evidence],
      reasonChips: [{
        kind: "pro",
        text: evidence.text,
        polarity: "positive",
        strength: 0.8,
        confidence: 0.72,
      }],
    }],
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

function draft(): DraftState {
  const ally = {
    cellId: 0,
    side: "ally" as const,
    role: "middle" as const,
    champion: aurelion,
    pickState: "hovering" as const,
    isLocalPlayer: true,
  };
  return {
    phase: "champSelect",
    allies: [ally],
    enemies: [{
      cellId: 5,
      side: "enemy",
      role: "middle",
      champion: bard,
      pickState: "locked",
      isLocalPlayer: false,
    }],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [0],
    localPlayer: ally,
  };
}

function status(state: ProDataStatus["state"]): ProDataStatus {
  return {
    state,
    source: state === "ranked-only" ? null : "Leaguepedia Cargo",
    generatedAt: state === "ranked-only" ? null : "2026-07-10T22:00:00.000Z",
    gameCount: state === "ranked-only" ? 0 : 320,
    lastError: null,
  };
}

function proEvidence(): ProEvidenceRecord {
  return {
    kind: "priority",
    text: "MSI · patch 26.13 · 7 picks / 2 bans",
    statistics: { picks: 7, bans: 2 },
    patches: ["26.13", "26.12"],
    competitions: ["MSI 2026"],
    teams: ["Bilibili Gaming"],
    effectiveSample: 7.9,
    confidence: 0.72,
    ageDays: 1,
    material: true,
  };
}

function champion(id: number, name: string): ChampionRef {
  return { id, name, slug: name.replace(/\W/g, ""), tags: [], iconUrl: "" };
}
