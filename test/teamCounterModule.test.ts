import { describe, expect, it } from "vitest";
import { createChampionAttributeProvider } from "../src/main/catalog/championAttributes";
import type {
  ChampionAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import {
  TeamCounterModule,
  candidateAnswers,
  candidateVulnerability,
  scoreCandidateTeamCounter,
} from "../src/main/engine/factors/teamCounterModule";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const provider = createChampionAttributeProvider("15.10.1");
const sett = mustChampion(875);
const thresh = mustChampion(412);
const xerath = mustChampion(101);

describe("TeamCounterModule", () => {
  it("lifts frontline and peel picks into a dive-heavy enemy comp", () => {
    const diveContext = contextWithThreats([{ kind: "dive", severity: 1 }], 1);
    const settContribution = scoreCandidateTeamCounter(
      sett,
      provider.getAttributes(sett, "ad"),
      diveContext,
    );
    const threshContribution = scoreCandidateTeamCounter(
      thresh,
      provider.getAttributes(thresh, "ad"),
      diveContext,
    );

    expect(settContribution.delta).toBeGreaterThan(0);
    expect(threshContribution.delta).toBeGreaterThan(0);
    expect(settContribution.reasons[0]).toEqual(
      expect.objectContaining({
        kind: "team-counter",
        polarity: "positive",
        text: "Frontline answers their dive",
      }),
    );
  });

  it("drops squishy immobile picks into the same dive threat", () => {
    const contribution = scoreCandidateTeamCounter(
      xerath,
      provider.getAttributes(xerath, "ap"),
      contextWithThreats([{ kind: "dive", severity: 1 }], 1),
    );

    expect(contribution.delta).toBeLessThan(0);
    expect(contribution.reasons).toEqual([
      expect.objectContaining({
        kind: "team-counter",
        polarity: "negative",
        text: "Squishy into their dive",
      }),
    ]);
  });

  it("scales effective delta and hedges chips when context confidence is low", () => {
    const assigned = scoreCandidateTeamCounter(
      xerath,
      provider.getAttributes(xerath, "ap"),
      contextWithThreats([{ kind: "dive", severity: 1 }], 1),
    );
    const inferred = scoreCandidateTeamCounter(
      xerath,
      provider.getAttributes(xerath, "ap"),
      contextWithThreats([{ kind: "dive", severity: 1 }], 0.3),
    );

    expect(assigned.delta).toBe(inferred.delta);
    expect(inferred.confidence).toBe(0.3);
    expect(Math.abs(inferred.delta * inferred.confidence)).toBeLessThan(
      Math.abs(assigned.delta * assigned.confidence),
    );
    expect(inferred.reasons[0]).toEqual(
      expect.objectContaining({
        text: "Possibly squishy into their dive",
        confidence: 0.3,
      }),
    );
  });

  it("scores simple answer and vulnerability mappings", () => {
    const settAttributes = provider.getAttributes(sett, "ad");
    const xerathAttributes = provider.getAttributes(xerath, "ap");

    expect(candidateAnswers("dive", settAttributes)).toBeGreaterThan(
      candidateVulnerability("dive", settAttributes),
    );
    expect(candidateAnswers("dive", xerathAttributes)).toBeLessThan(
      candidateVulnerability("dive", xerathAttributes),
    );
  });

  it("uses shared champion analysis damage style when loaded as a module", async () => {
    const meta = new FakeMetaDataSource();
    meta.setAnalysis(sett, { damageStyle: "ad", synergies: [] });
    const module = new TeamCounterModule(
      meta,
      provider,
      () => "global",
      () => "emerald_plus",
      () => 0.58,
    );
    const contribution = await module.contribute(
      sett,
      createDraft({ localPlayer: player(0, "top", null, true) }),
      contextWithThreats([{ kind: "dive", severity: 1 }], 1),
    );

    expect(meta.analysisCalls).toBe(1);
    expect(contribution.factor).toBe("teamCounter");
    expect(contribution.delta).toBeGreaterThan(0);
  });
});

function contextWithThreats(
  enemyThreats: TeamContext["enemyThreats"],
  confidence: number,
): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [],
    enemyThreats,
    confidence,
  };
}

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  const localPlayer = player(0, "middle", null, true);

  return {
    phase: "champSelect",
    allies: [localPlayer],
    enemies: [],
    bans: [],
    localPlayer,
    laneOpponent: null,
    ...overrides,
  };
}

function player(
  cellId: number,
  role: Role | null,
  champion: ChampionRef | null,
  isLocalPlayer: boolean,
): DraftPlayer {
  return {
    cellId,
    role,
    champion,
    isLocalPlayer,
  };
}

function emptyComposition(): TeamContext["ally"] {
  return {
    adWeight: 0,
    apWeight: 0,
    engage: 0,
    peel: 0,
    frontline: 0,
    poke: 0,
    waveclear: 0,
    cc: 0,
    mobility: 0,
    carryPotential: 0,
    rangedCount: 0,
    powerCurve: { early: 0, mid: 0, late: 0 },
    championCount: 0,
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

class FakeMetaDataSource implements MetaDataSource {
  analysisCalls = 0;
  private readonly analyses = new Map<number, ChampionAnalysis>();

  setAnalysis(champion: ChampionRef, analysis: ChampionAnalysis): void {
    this.analyses.set(champion.id, analysis);
  }

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    return [];
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
  }

  async getChampionAnalysis(champion: ChampionRef): Promise<ChampionAnalysis> {
    this.analysisCalls += 1;
    return this.analyses.get(champion.id) ?? { damageStyle: "unknown", synergies: [] };
  }

  async getChampionRoleFit(): Promise<RoleFit> {
    return {
      top: 0,
      jungle: 0,
      middle: 0,
      bottom: 0,
      utility: 0,
    };
  }
}
