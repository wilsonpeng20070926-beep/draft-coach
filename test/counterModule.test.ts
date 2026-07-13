import { describe, expect, it } from "vitest";
import type {
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import { CounterModule, mapMatchupWinRate } from "../src/main/engine/factors/counterModule";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const ahri = mustChampion(103);
const darius = mustChampion(122);
const yasuo = mustChampion(157);

describe("CounterModule", () => {
  it("returns neutral when lane opponent is unknown", async () => {
    const module = createModule(new FakeMetaDataSource());

    const contribution = await module.contribute(ahri, createDraft({ enemies: [] }), target(), neutralCtx());

    expect(contribution).toEqual({
      factor: "laneCounter",
      delta: 0,
      confidence: 0,
      reasons: [],
    });
  });

  it("returns neutral when matchup data is null", async () => {
    const meta = new FakeMetaDataSource();
    meta.winRate = null;
    const module = createModule(meta);

    const contribution = await module.contribute(ahri, createDraft(), target(), neutralCtx());

    expect(contribution.delta).toBe(0);
    expect(contribution.confidence).toBe(0);
    expect(contribution.reasons).toEqual([]);
  });

  it("resolves lane opponent and role relative to the explicit target", async () => {
    const meta = new FakeMetaDataSource();
    const module = createModule(meta);
    const draft = createDraft({
      allies: [
        player(0, "middle", null, true),
        player(1, "top", null, false, "assigned", 1, "ally"),
      ],
      enemies: [
        player(5, "top", darius, false, "assigned", 1),
        player(6, "middle", yasuo, false, "assigned", 1),
      ],
    });

    await module.contribute(ahri, draft, target(1, "top"), neutralCtx());

    expect(meta.lastOpponent?.name).toBe("Darius");
    expect(meta.lastRole).toBe("top");
  });

  it("maps matchup win rates into the expected band", () => {
    expect(mapMatchupWinRate(0.42)).toBe(0);
    expect(mapMatchupWinRate(0.5)).toBeCloseTo(0.5, 5);
    expect(mapMatchupWinRate(0.58)).toBeCloseTo(1, 5);
  });

  it("labels favored, even, and risky matchups", async () => {
    const meta = new FakeMetaDataSource();
    const module = createModule(meta);

    meta.winRate = 0.54;
    await expect(module.contribute(ahri, createDraft(), target(), neutralCtx())).resolves.toMatchObject({
      reasons: [expect.objectContaining({ text: "Favored vs Yasuo (54%)", polarity: "positive" })],
    });

    meta.winRate = 0.5;
    await expect(module.contribute(ahri, createDraft(), target(), neutralCtx())).resolves.toMatchObject({
      reasons: [expect.objectContaining({ text: "Even vs Yasuo (50%)", polarity: "neutral" })],
    });

    meta.winRate = 0.46;
    await expect(module.contribute(ahri, createDraft(), target(), neutralCtx())).resolves.toMatchObject({
      reasons: [expect.objectContaining({ text: "Risky into Yasuo (46%)", polarity: "negative" })],
    });
  });

  it("blends inferred matchup scores toward neutral by confidence", async () => {
    const meta = new FakeMetaDataSource();
    meta.winRate = 0.58;
    const module = createModule(meta);

    const fullConfidence = await module.contribute(
      ahri,
      createDraft({
        enemies: [player(5, "middle", yasuo, false, "inferred", 1)],
      }),
      target(),
      neutralCtx(),
    );
    const lowConfidence = await module.contribute(
      ahri,
      createDraft({
        enemies: [player(5, "middle", yasuo, false, "inferred", 0.3)],
      }),
      target(),
      neutralCtx(),
    );

    expect(fullConfidence.delta).toBeCloseTo(0.16, 5);
    expect(fullConfidence.confidence).toBe(1);
    expect(lowConfidence.delta).toBeCloseTo(0.16, 5);
    expect(lowConfidence.confidence).toBe(0.3);
    expect(0.5 + lowConfidence.delta * lowConfidence.confidence).toBeCloseTo(0.548, 5);
  });

  it("softens reason wording for inferred lane opponents", async () => {
    const meta = new FakeMetaDataSource();
    meta.winRate = 0.54;
    const module = createModule(meta, 0);

    await expect(
      module.contribute(
        ahri,
        createDraft({
          enemies: [player(5, "middle", yasuo, false, "inferred", 0.7)],
        }),
        target(),
        neutralCtx(),
      ),
    ).resolves.toMatchObject({
      reasons: [expect.objectContaining({ text: "Likely vs Yasuo (54%)" })],
    });

    await expect(
      module.contribute(
        ahri,
        createDraft({
          enemies: [player(5, "middle", yasuo, false, "inferred", 0.3)],
        }),
        target(),
        neutralCtx(),
      ),
    ).resolves.toMatchObject({
      reasons: [expect.objectContaining({ text: "Possibly vs Yasuo (54%)" })],
    });
  });

  it("hides low-confidence matchup chips below the configured threshold", async () => {
    const meta = new FakeMetaDataSource();
    meta.winRate = 0.54;
    const module = createModule(meta, 0.58);

    await expect(
      module.contribute(
        ahri,
        createDraft({
          enemies: [player(5, "middle", yasuo, false, "inferred", 0.3)],
        }),
        target(),
        neutralCtx(),
      ),
    ).resolves.toMatchObject({
      delta: expect.any(Number),
      confidence: 0.3,
      reasons: [],
    });
  });
});

function createModule(meta: MetaDataSource, minChipConfidence = 0.58): CounterModule {
  return new CounterModule(
    meta,
    () => "global",
    () => "emerald_plus",
    () => minChipConfidence,
  );
}

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  const localPlayer = player(0, "middle", null, true);
  const laneOpponent = player(5, "middle", yasuo, false);

  return {
    phase: "champSelect",
    allies: [localPlayer],
    enemies: [laneOpponent],
    bans: [darius],
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
  roleSource?: DraftPlayer["roleSource"],
  roleConfidence?: number,
  side: DraftPlayer["side"] = isLocalPlayer ? "ally" : "enemy",
): DraftPlayer {
  return {
    cellId,
    side,
    role,
    champion,
    pickState: champion ? "locked" : "empty",
    isLocalPlayer,
    roleSource,
    roleConfidence,
  };
}

function target(cellId = 0, role: Role = "middle") {
  return {
    side: "ally" as const,
    cellId,
    role,
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
  winRate: number | null = 0.5;
  lastOpponent: ChampionRef | null = null;
  lastRole: Role | null = null;

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    return [];
  }

  async getMatchup(
    _candidate: ChampionRef,
    opponent: ChampionRef,
    role: Role,
  ): Promise<MatchupResult> {
    this.lastOpponent = opponent;
    this.lastRole = role;
    return { winRate: this.winRate };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
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
