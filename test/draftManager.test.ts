import { describe, expect, it } from "vitest";
import {
  inferDraftStateEnemyRoles,
  resolveTargetLaneOpponent,
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
    expect(resolveTargetLaneOpponent(draftState, allyTarget(2, "middle"))?.cellId).toBe(7);
    expect(resolveTargetLaneOpponent(draftState, allyTarget(2, "middle"))?.champion?.name).toBe("Ahri");
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
    expect(resolveTargetLaneOpponent(draftState, allyTarget(2, "middle"))).toBeNull();
  });

  it("returns null lane opponent when enemy role matches are ambiguous", () => {
    const catalog = createFixtureCatalog();
    const session = createSession({
      secondEnemyMiddleRole: "middle",
    });
    const draftState = toDraftState(session, "ChampSelect", catalog);

    expect(draftState.localPlayer?.role).toBe("middle");
    expect(draftState.enemies.filter((enemy) => enemy.role === "middle")).toHaveLength(2);
    expect(resolveTargetLaneOpponent(draftState, allyTarget(2, "middle"))).toBeNull();
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

    const opponent = resolveTargetLaneOpponent(inferred, allyTarget(2, "middle"));

    expect(opponent?.champion?.name).toBe("Ahri");
    expect(opponent?.roleSource).toBe("inferred");
    expect(opponent?.roleConfidence).toBeGreaterThan(0.8);
  });

  it("infers the only remaining role for an unpicked enemy cell", async () => {
    const catalog = createFixtureCatalog();
    const session = createSession();
    const enemies = session.theirTeam as Array<Record<string, unknown>>;
    enemies[4] = { ...enemies[4], assignedPosition: "" };
    const draft = toDraftState(session, "ChampSelect", catalog);
    const inferred = await inferDraftStateEnemyRoles(
      draft,
      async () => createEmptyRoleFit(),
    );

    expect(inferred.enemies[4]).toMatchObject({
      champion: null,
      role: "utility",
      roleSource: "inferred",
      roleConfidence: 0.55,
    });
  });

  it("preserves pick action ownership and distinguishes hover from lock", () => {
    const catalog = createFixtureCatalog();
    const session = createSession();
    session.actions = [
      [
        {
          id: 91,
          actorCellId: 2,
          championId: 103,
          type: "pick",
          completed: false,
          isInProgress: true,
        },
        {
          id: 92,
          actorCellId: 3,
          championId: 222,
          type: "pick",
          completed: true,
          isInProgress: false,
        },
      ],
    ];
    const draft = toDraftState(session, "ChampSelect", catalog);

    expect(draft.pickActions).toEqual([
      expect.objectContaining({
        id: 91,
        actorCellId: 2,
        championId: 103,
        completed: false,
        isInProgress: true,
        groupIndex: 0,
        order: 0,
      }),
      expect.objectContaining({ id: 92, actorCellId: 3, completed: true }),
    ]);
    expect(draft.allies.find((ally) => ally.cellId === 2)).toMatchObject({
      pickState: "hovering",
      champion: expect.objectContaining({ name: "Ahri" }),
    });
    expect(draft.allies.find((ally) => ally.cellId === 3)).toMatchObject({
      pickState: "locked",
      champion: expect.objectContaining({ name: "Jinx" }),
    });
    expect(draft.activeAllyPickCellIds).toEqual([2]);
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
        { id: 10, actorCellId: 0, championId: 266, type: "pick", completed: true },
        { id: 11, actorCellId: 1, championId: 875, type: "pick", completed: true },
        { id: 12, actorCellId: 2, championId: 157, type: "pick", completed: true },
        { id: 13, actorCellId: 3, championId: 222, type: "pick", completed: true },
        { id: 14, actorCellId: 4, championId: 412, type: "pick", completed: true },
        { id: 15, actorCellId: 5, championId: 62, type: "pick", completed: true },
        { id: 16, actorCellId: 7, championId: 103, type: "pick", completed: true },
        { championId: 0, type: "ban", completed: true },
        { championId: 412, type: "ban", completed: false },
      ],
    ],
  };
}

function allyTarget(cellId: number, role: "middle") {
  return {
    side: "ally" as const,
    cellId,
    role,
    source: "automatic" as const,
    purpose: "recommend" as const,
  };
}
