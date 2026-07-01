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
  CompFitModule,
  candidateProvides,
  scoreCandidateCompFit,
} from "../src/main/engine/factors/compFitModule";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const provider = createChampionAttributeProvider("15.10.1");
const brand = mustChampion(63);
const gragas = mustChampion(79);
const jinx = mustChampion(222);
const sett = mustChampion(875);

describe("CompFitModule", () => {
  it("rewards AP when the ally team is AD-heavy", () => {
    const contribution = scoreCandidateCompFit(
      brand,
      provider.getAttributes(brand, "ap"),
      contextWithNeeds([{ kind: "ap", severity: 0.9 }], 0.7),
    );

    expect(contribution.delta).toBeGreaterThan(0.1);
    expect(contribution.confidence).toBe(0.7);
    expect(contribution.reasons).toEqual([
      expect.objectContaining({
        text: "Adds AP to an AD-heavy team",
        kind: "comp-fit",
        polarity: "positive",
      }),
    ]);
  });

  it("stays near zero when the candidate does not fill the active gap", () => {
    const contribution = scoreCandidateCompFit(
      jinx,
      provider.getAttributes(jinx, "ad"),
      contextWithNeeds([{ kind: "ap", severity: 0.9 }], 0.8),
    );

    expect(contribution.delta).toBe(0);
    expect(contribution.reasons).toEqual([]);
  });

  it("returns zero when the ally team has no active needs", () => {
    const contribution = scoreCandidateCompFit(
      brand,
      provider.getAttributes(brand, "ap"),
      contextWithNeeds([], 0.9),
    );

    expect(contribution).toEqual({
      factor: "compFit",
      delta: 0,
      confidence: 0,
      reasons: [],
      breakdown: [],
    });
  });

  it("scores other need kinds through candidateProvides", () => {
    const settAttributes = provider.getAttributes(sett, "ad");

    expect(candidateProvides("frontline", settAttributes)).toBeGreaterThan(0.7);
    expect(candidateProvides("engage", settAttributes)).toBeGreaterThan(0.5);
  });

  it("uses candidate analysis damage style before deriving attributes", async () => {
    const meta = new FakeMetaDataSource();
    meta.setAnalysis(gragas, { damageStyle: "ap", synergies: [] });
    const module = new CompFitModule(
      meta,
      provider,
      () => "global",
      () => "emerald_plus",
    );
    const contribution = await module.contribute(
      gragas,
      createDraft({ localPlayer: player(0, "jungle", null, true) }),
      contextWithNeeds([{ kind: "ap", severity: 0.8 }], 0.8),
    );

    expect(meta.analysisCalls).toBe(1);
    expect(contribution.delta).toBeGreaterThan(0.1);
    expect(contribution.reasons[0].text).toBe("Adds AP to an AD-heavy team");
  });
});

function contextWithNeeds(
  allyNeeds: TeamContext["allyNeeds"],
  confidence: number,
): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds,
    enemyThreats: [],
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
