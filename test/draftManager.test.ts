import { describe, expect, it } from "vitest";
import {
  inferDraftStateEnemyRoles,
  toDraftState,
  type RawChampSelectSession,
} from "../src/main/draft/draftManager";
import { createEmptyRoleFit } from "../src/main/draft/roleInference";
import { createFixtureCatalog } from "./fixtures/championFixture";

describe("draft manager", () => {
  it("resolves champions, roles, local player, bans, and unique lane opponent", () => {
    const catalog = createFixtureCatalog();
    const draftState = toDraftState(createSession(), "ChampSelect", catalog);

    expect(draftState.phase).toBe("champSelect");
    expect(draftState.allies).toHaveLength(5);
    expect(draftState.enemies).toHaveLength(5);
    expect(draftState.localPlayer?.cellId).toBe(2);
    expect(draftState.localPlayer?.isLocalPlayer).toBe(true);
    expect(draftState.localPlayer?.champion?.name).toBe("Yasuo");
    expect(draftState.laneOpponent?.cellId).toBe(7);
    expect(draftState.laneOpponent?.champion?.name).toBe("Ahri");
    expect(draftState.bans.map((champion) => champion.name)).toEqual(["Darius", "Jax"]);
  });

  it("returns null lane opponent when roles are empty", () => {
    const catalog = createFixtureCatalog();
    const session = createSession({
      allyRole: "",
      enemyMiddleRole: "",
    });
    const draftState = toDraftState(session, "ChampSelect", catalog);

    expect(draftState.localPlayer?.role).toBeNull();
    expect(draftState.laneOpponent).toBeNull();
  });

  it("returns null lane opponent when enemy role matches are ambiguous", () => {
    const catalog = createFixtureCatalog();
    const session = createSession({
      secondEnemyMiddleRole: "middle",
    });
    const draftState = toDraftState(session, "ChampSelect", catalog);

    expect(draftState.localPlayer?.role).toBe("middle");
    expect(draftState.enemies.filter((enemy) => enemy.role === "middle")).toHaveLength(2);
    expect(draftState.laneOpponent).toBeNull();
  });

  it("maps non-champ-select phases into DraftState phases", () => {
    const catalog = createFixtureCatalog();

    expect(toDraftState(createSession(), "InProgress", catalog).phase).toBe("inProgress");
    expect(toDraftState(createSession(), "GameStart", catalog).phase).toBe("inProgress");
    expect(toDraftState(createSession(), "None", catalog).phase).toBe("none");
    expect(toDraftState(createSession(), "Lobby", catalog).phase).toBe("other");
  });

  it("fills missing enemy roles by inference and resolves lane opponent", async () => {
    const catalog = createFixtureCatalog();
    const draftState = toDraftState(
      createSession({
        enemyMiddleRole: "",
        secondEnemyMiddleRole: "",
      }),
      "ChampSelect",
      catalog,
    );
    const inferred = await inferDraftStateEnemyRoles(draftState, async (champion) => ({
      ...createEmptyRoleFit(),
      middle: champion.name === "Ahri" ? 1 : 0.1,
      top: champion.name === "Wukong" ? 1 : 0.1,
    }));

    expect(inferred.laneOpponent?.champion?.name).toBe("Ahri");
    expect(inferred.laneOpponent?.roleSource).toBe("inferred");
    expect(inferred.laneOpponent?.roleConfidence).toBeGreaterThan(0.8);
  });
});

function createSession(
  options: {
    allyRole?: string;
    enemyMiddleRole?: string;
    secondEnemyMiddleRole?: string;
  } = {},
): RawChampSelectSession {
  const allyRole = options.allyRole ?? "middle";
  const enemyMiddleRole = options.enemyMiddleRole ?? "middle";
  const secondEnemyMiddleRole = options.secondEnemyMiddleRole ?? "top";

  return {
    localPlayerCellId: 2,
    myTeam: [
      { cellId: 0, championId: 266, assignedPosition: "top" },
      { cellId: 1, championId: 875, assignedPosition: "jungle" },
      { cellId: 2, championId: 157, assignedPosition: allyRole },
      { cellId: 3, championId: 222, assignedPosition: "bottom" },
      { cellId: 4, championId: 412, assignedPosition: "utility" },
    ],
    theirTeam: [
      { cellId: 5, championId: 62, assignedPosition: secondEnemyMiddleRole },
      { cellId: 6, championId: 0, assignedPosition: "jungle" },
      { cellId: 7, championId: 103, assignedPosition: enemyMiddleRole },
      { cellId: 8, championId: 0, assignedPosition: "bottom" },
      { cellId: 9, championId: 0, assignedPosition: "utility" },
    ],
    actions: [
      [
        { championId: 122, type: "ban", completed: true },
        { championId: 24, type: "ban", completed: true },
        { championId: 24, type: "ban", completed: true },
      ],
      [
        { championId: 875, type: "pick", completed: true },
        { championId: 0, type: "ban", completed: true },
        { championId: 412, type: "ban", completed: false },
      ],
    ],
  };
}
