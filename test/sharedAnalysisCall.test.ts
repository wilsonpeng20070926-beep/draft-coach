import { describe, expect, it } from "vitest";
import { createChampionAttributeProvider } from "../src/main/catalog/championAttributes";
import { CachedMetaDataSource } from "../src/main/data/cache";
import type {
  ChampionAnalysis,
  ChampionSynergyAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import { CompFitModule } from "../src/main/engine/factors/compFitModule";
import { SynergyModule } from "../src/main/engine/factors/synergyModule";
import { TeamCounterModule } from "../src/main/engine/factors/teamCounterModule";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const provider = createChampionAttributeProvider("15.10.1");
const nocturne = mustChampion(56);
const orianna = mustChampion(61);

describe("shared champion analysis cache", () => {
  it("lets synergy, comp-fit, and team-counter share one cached candidate analysis call", async () => {
    const rawSource = new CountingAnalysisSource();
    rawSource.setAnalysis(
      orianna,
      analysisFor(orianna, [synergy(orianna, nocturne, "jungle", 0.9, 0, 2600, 1)]),
    );
    const cachedSource = new CachedMetaDataSource(rawSource, {
      ttlMs: 60_000,
      patchVersion: "test",
    });
    const synergyModule = new SynergyModule(
      cachedSource,
      () => "global",
      () => "emerald_plus",
      () => 0.58,
    );
    const compFitModule = new CompFitModule(
      cachedSource,
      provider,
      () => "global",
      () => "emerald_plus",
    );
    const teamCounterModule = new TeamCounterModule(
      cachedSource,
      provider,
      () => "global",
      () => "emerald_plus",
      () => 0.58,
    );
    const draft = createDraft({
      allies: [player(0, "middle", null, true), player(1, "jungle", nocturne, false)],
    });

    await Promise.all([
      synergyModule.contribute(orianna, draft, contextWithSignals()),
      compFitModule.contribute(orianna, draft, contextWithSignals()),
      teamCounterModule.contribute(orianna, draft, contextWithSignals()),
    ]);

    expect(rawSource.analysisCalls).toBe(1);
  });
});

function analysisFor(
  champion: ChampionRef,
  synergies: ChampionSynergyAnalysis[],
): ChampionAnalysis {
  return {
    damageStyle: champion.tags.includes("Mage") ? "ap" : "ad",
    synergies,
  };
}

function synergy(
  champion: ChampionRef,
  partner: ChampionRef,
  partnerPosition: Role,
  score: number,
  tier: number,
  sampleSize: number,
  confidence: number,
): ChampionSynergyAnalysis {
  return {
    championId: champion.id,
    championName: champion.name,
    partnerChampionId: partner.id,
    partnerChampionName: partner.name,
    partnerPosition,
    score,
    confidence,
    sampleSize,
    tier,
    winRate: 0.53,
    notable: tier <= 1,
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

function contextWithSignals(): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [{ kind: "ap", severity: 0.8 }],
    enemyThreats: [{ kind: "dive", severity: 0.8 }],
    confidence: 0.8,
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

class CountingAnalysisSource implements MetaDataSource {
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
    await Promise.resolve();
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
