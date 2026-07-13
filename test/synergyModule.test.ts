import { describe, expect, it } from "vitest";
import type {
  ChampionAnalysis,
  ChampionSynergyAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import {
  SynergyModule,
  scoreCandidateSynergy,
  type SynergyAlly,
} from "../src/main/engine/factors/synergyModule";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const ahri = mustChampion(103);
const darius = mustChampion(122);
const jax = mustChampion(24);
const nocturne = mustChampion(56);
const orianna = mustChampion(61);
const wukong = mustChampion(62);

describe("SynergyModule", () => {
  it("returns neutral when there are no locked allies", async () => {
    const module = createModule(new FakeMetaDataSource());

    const contribution = await module.contribute(ahri, createDraft(), target(), neutralCtx());

    expect(contribution).toEqual({
      factor: "synergy",
      delta: 0,
      confidence: 0,
      reasons: [],
      breakdown: [],
    });
  });

  it("uses the candidate analysis call and emits a per-ally breakdown", async () => {
    const meta = new FakeMetaDataSource();
    meta.setAnalysis(
      ahri,
      analysisFor(ahri, [synergy(ahri, darius, "top", 0.78, 1, 900, 1)]),
    );
    const module = createModule(meta);

    const contribution = await module.contribute(
      ahri,
      createDraft({
        allies: [player(0, "middle", null, true), player(1, "top", darius, false)],
      }),
      target(),
      neutralCtx(),
    );

    expect(meta.analysisCalls).toBe(1);
    expect(contribution.delta).toBeCloseTo(0.196, 5);
    expect(contribution.confidence).toBe(1);
    expect(contribution.breakdown).toEqual([
      expect.objectContaining({
        championName: "Darius",
        label: "S-tier with Darius",
        tier: 1,
        value: 0.78,
      }),
    ]);
    expect(contribution.reasons).toEqual([
      expect.objectContaining({ text: "S-tier synergy with Darius", kind: "synergy" }),
    ]);
  });

  it("uses max-plus-mean so one elite partner is not drowned by neutral allies", () => {
    const allies: SynergyAlly[] = [
      { champion: darius, role: "top" },
      { champion: jax, role: "jungle" },
      { champion: wukong, role: "utility" },
    ];
    const contribution = scoreCandidateSynergy(
      ahri,
      allies,
      analysisFor(ahri, [synergy(ahri, darius, "top", 0.9, 0, 2000, 1)]),
      0.58,
    );

    expect(contribution.delta).toBeGreaterThan(0.18);
    expect(contribution.confidence).toBeGreaterThan(0.7);
    expect(contribution.breakdown).toHaveLength(3);
  });

  it("separates tier-0/1 pairings from tier-3/4 pairings for the same candidate", () => {
    const ally = [{ champion: nocturne, role: "jungle" }] satisfies SynergyAlly[];
    const tierOne = scoreCandidateSynergy(
      orianna,
      ally,
      analysisFor(orianna, [synergy(orianna, nocturne, "jungle", 0.78, 1, 2600, 1)]),
      0.58,
    );
    const tierFour = scoreCandidateSynergy(
      orianna,
      ally,
      analysisFor(orianna, [synergy(orianna, nocturne, "jungle", 0.42, 4, 2600, 1)]),
      0.58,
    );

    expect(tierOne.delta).toBeGreaterThan(tierFour.delta + 0.15);
    expect(tierOne.reasons[0].text).toBe("S-tier synergy with Nocturne");
    expect(tierFour.reasons).toEqual([]);
  });

  it("hedges chips when the pair confidence is below the configured threshold", () => {
    const contribution = scoreCandidateSynergy(
      orianna,
      [{ champion: nocturne, role: "jungle" }],
      analysisFor(orianna, [synergy(orianna, nocturne, "jungle", 0.78, 1, 900, 0.4)]),
      0.58,
    );

    expect(contribution.reasons).toEqual([
      expect.objectContaining({ text: "Possible S-tier synergy with Nocturne" }),
    ]);
  });
});

function createModule(meta: MetaDataSource, minChipConfidence = 0.58): SynergyModule {
  return new SynergyModule(
    meta,
    () => "global",
    () => "emerald_plus",
    () => minChipConfidence,
  );
}

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
    winRate: 0.52,
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
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer,
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
    side: "ally",
    role,
    champion,
    pickState: champion ? "locked" : "empty",
    isLocalPlayer,
  };
}

function target() {
  return {
    side: "ally" as const,
    cellId: 0,
    role: "middle" as const,
    source: "automatic" as const,
    purpose: "recommend" as const,
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

function neutralCtx() {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [],
    enemyThreats: [],
    confidence: 0,
  };
}

function emptyComposition() {
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
