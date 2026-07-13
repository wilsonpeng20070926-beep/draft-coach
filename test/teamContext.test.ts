import { describe, expect, it } from "vitest";
import { createChampionAttributeProvider } from "../src/main/catalog/championAttributes";
import { buildTeamContext } from "../src/main/draft/teamContext";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const attributes = createChampionAttributeProvider("15.10.1");

describe("team context", () => {
  it("is pure and deterministic for the same draft and attributes", () => {
    const draft = draftState({
      allies: [player(1, mustChampion(222), "bottom"), player(2, mustChampion(157), "middle")],
      enemies: [player(6, mustChampion(56), "jungle")],
    });

    expect(buildTeamContext(draft, attributes.getAttributes)).toEqual(
      buildTeamContext(draft, attributes.getAttributes),
    );
  });

  it("flags an AP need for a heavily AD ally composition", () => {
    const context = buildTeamContext(
      draftState({
        allies: [
          player(1, mustChampion(222), "bottom"),
          player(2, mustChampion(157), "middle"),
          player(3, mustChampion(122), "top"),
        ],
      }),
      attributes.getAttributes,
    );
    const apNeed = context.allyNeeds.find((need) => need.kind === "ap");

    expect(apNeed?.severity).toBeGreaterThan(0.5);
  });

  it("does not flag damage-mix needs for a balanced AD/AP ally composition", () => {
    const context = buildTeamContext(
      draftState({
        allies: [player(1, mustChampion(222), "bottom"), player(2, mustChampion(61), "middle")],
      }),
      attributes.getAttributes,
    );

    expect(context.allyNeeds.some((need) => need.kind === "ap" || need.kind === "ad")).toBe(false);
  });

  it("keeps ally needs empty before any allies are locked", () => {
    const context = buildTeamContext(draftState({ allies: [] }), attributes.getAttributes);

    expect(context.ally.championCount).toBe(0);
    expect(context.allyNeeds).toEqual([]);
  });

  it("does not let another ally hover alter locked team composition", () => {
    const lockedOnly = buildTeamContext(
      draftState({ allies: [player(1, mustChampion(222), "bottom")] }),
      attributes.getAttributes,
    );
    const withHover = buildTeamContext(
      draftState({
        allies: [
          player(1, mustChampion(222), "bottom"),
          player(2, mustChampion(61), "middle", "assigned", 1, "hovering"),
        ],
      }),
      attributes.getAttributes,
    );

    expect(withHover).toEqual(lockedOnly);
    expect(withHover.ally.championCount).toBe(1);
  });

  it("detects dive threats and dampens them when enemy roles are low confidence", () => {
    const assignedContext = buildTeamContext(
      draftState({
        enemies: [
          player(6, mustChampion(56), "jungle", "assigned", 1),
          player(7, mustChampion(59), "top", "assigned", 1),
          player(8, mustChampion(105), "middle", "assigned", 1),
        ],
      }),
      attributes.getAttributes,
    );
    const inferredContext = buildTeamContext(
      draftState({
        enemies: [
          player(6, mustChampion(56), "jungle", "inferred", 0.3),
          player(7, mustChampion(59), "top", "inferred", 0.3),
          player(8, mustChampion(105), "middle", "inferred", 0.3),
        ],
      }),
      attributes.getAttributes,
    );
    const assignedDive = threatSeverity(assignedContext, "dive");
    const inferredDive = threatSeverity(inferredContext, "dive");

    expect(assignedDive).toBeGreaterThan(0.4);
    expect(inferredDive).toBeGreaterThan(0);
    expect(inferredDive).toBeLessThan(assignedDive);
  });

  it("returns no enemy threats without enemy information", () => {
    const context = buildTeamContext(draftState({ enemies: [] }), attributes.getAttributes);

    expect(context.enemy.championCount).toBe(0);
    expect(context.enemyThreats).toEqual([]);
  });

  it("raises context confidence as more picks and assigned enemy roles are known", () => {
    const sparse = buildTeamContext(
      draftState({
        allies: [player(1, mustChampion(222), "bottom")],
        enemies: [player(6, mustChampion(56), "jungle", "inferred", 0.3)],
      }),
      attributes.getAttributes,
    );
    const richer = buildTeamContext(
      draftState({
        allies: [
          player(1, mustChampion(222), "bottom"),
          player(2, mustChampion(61), "middle"),
          player(3, mustChampion(875), "top"),
        ],
        enemies: [
          player(6, mustChampion(56), "jungle", "assigned", 1),
          player(7, mustChampion(59), "top", "assigned", 1),
        ],
      }),
      attributes.getAttributes,
    );

    expect(richer.confidence).toBeGreaterThan(sparse.confidence);
  });
});

function threatSeverity(
  context: ReturnType<typeof buildTeamContext>,
  kind: ReturnType<typeof buildTeamContext>["enemyThreats"][number]["kind"],
): number {
  return context.enemyThreats.find((threat) => threat.kind === kind)?.severity ?? 0;
}

function draftState(options: {
  allies?: DraftPlayer[];
  enemies?: DraftPlayer[];
  bans?: ChampionRef[];
}): DraftState {
  const allies = options.allies ?? [];

  return {
    phase: "champSelect",
    allies,
    enemies: options.enemies ?? [],
    bans: options.bans ?? [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer: allies[0] ?? null,
  };
}

function player(
  cellId: number,
  champion: ChampionRef,
  role: Role,
  roleSource: DraftPlayer["roleSource"] = "assigned",
  roleConfidence = 1,
  pickState: DraftPlayer["pickState"] = "locked",
): DraftPlayer {
  return {
    cellId,
    side: cellId >= 5 ? "enemy" : "ally",
    role,
    champion,
    pickState,
    isLocalPlayer: cellId === 1,
    roleSource,
    roleConfidence,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}
