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
import { buildAnalysisBackedTeamContext } from "../src/main/engine/teamContextProvider";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const provider = createChampionAttributeProvider("15.10.1");
const jinx = mustChampion(222);
const orianna = mustChampion(61);

describe("analysis-backed TeamContext provider", () => {
  it("uses cached analysis damage style while deriving ally needs", async () => {
    const source = new FakeAnalysisSource();
    source.setAnalysis(jinx, { damageStyle: "ad", synergies: [] });
    source.setAnalysis(orianna, { damageStyle: "ad", synergies: [] });
    const draft = createDraft({
      allies: [
        player(1, "bottom", jinx, true),
        player(2, "middle", orianna, false),
      ],
    });

    const context = await buildAnalysisBackedTeamContext(draft, source, provider, {
      region: "global",
      rank: "emerald_plus",
    });

    expect(source.analysisCalls).toBe(2);
    expect(context.allyNeeds.some((need) => need.kind === "ap")).toBe(true);
  });
});

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

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

class FakeAnalysisSource implements MetaDataSource {
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
