import { useState } from "react";
import type {
  ChampionRef,
  DraftPlayer,
  DraftSimulationState,
  PickState,
  Role,
  SimulationCommand,
} from "../../shared/types";

interface SimulationPanelProps {
  state: DraftSimulationState;
  champions: ChampionRef[];
  favoriteTeams: string[];
  onCommand: (command: SimulationCommand) => void;
}

const roles: Role[] = ["top", "jungle", "middle", "bottom", "utility"];

export function SimulationPanel({
  state,
  champions,
  favoriteTeams,
  onCommand,
}: SimulationPanelProps): JSX.Element {
  const [banChampionId, setBanChampionId] = useState(0);

  return (
    <section className="simulation-panel" aria-label="manual draft simulator">
      <div className="simulation-toolbar">
        <div>
          <b>Hypothetical simulator</b>
          <span>Offline planning only</span>
        </div>
        <button
          type="button"
          disabled={state.history.length === 0}
          onClick={() => onCommand({ type: "undo" })}
        >
          Undo
        </button>
        <button type="button" onClick={() => onCommand({ type: "reset" })}>
          Reset
        </button>
      </div>
      {favoriteTeams.length > 0 ? (
        <p className="simulation-context" title={favoriteTeams.join(", ")}>
          Favorite-team strategy · {favoriteTeams.join(" · ")}
        </p>
      ) : (
        <p className="simulation-context">Global professional strategy context</p>
      )}

      <SimulationTeam
        title="Allies"
        players={state.draft.allies}
        champions={champions}
        targetCellId={state.target?.side === "ally" ? state.target.cellId : null}
        onCommand={onCommand}
      />
      <SimulationTeam
        title="Enemies"
        players={state.draft.enemies}
        champions={champions}
        targetCellId={state.target?.side === "enemy" ? state.target.cellId : null}
        onCommand={onCommand}
      />

      <div className="simulation-bans">
        <label>
          <span>Ban champion</span>
          <select
            value={banChampionId}
            onChange={(event) => setBanChampionId(Number(event.target.value))}
          >
            <option value={0}>Choose champion</option>
            {champions.map((champion) => (
              <option key={champion.id} value={champion.id}>
                {champion.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={banChampionId <= 0}
          onClick={() => {
            onCommand({ type: "ban", championId: banChampionId });
            setBanChampionId(0);
          }}
        >
          Ban
        </button>
      </div>
      {state.draft.bans.length > 0 ? (
        <div className="simulation-ban-list" aria-label="simulation bans">
          {state.draft.bans.map((champion) => (
            <button
              key={champion.id}
              type="button"
              onClick={() => onCommand({ type: "unban", championId: champion.id })}
            >
              {champion.name} ×
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SimulationTeam({
  title,
  players,
  champions,
  targetCellId,
  onCommand,
}: {
  title: string;
  players: DraftPlayer[];
  champions: ChampionRef[];
  targetCellId: number | null;
  onCommand: (command: SimulationCommand) => void;
}): JSX.Element {
  return (
    <div className="simulation-team">
      <h2>{title}</h2>
      {players.map((player) => (
        <div
          className="simulation-slot"
          data-target={player.cellId === targetCellId}
          key={`${player.side}-${player.cellId}`}
        >
          <select
            aria-label={`${title} slot ${player.cellId} role`}
            value={player.role ?? ""}
            onChange={(event) =>
              onCommand({
                type: "assignRole",
                side: player.side,
                cellId: player.cellId,
                role: (event.target.value || null) as Role | null,
              })
            }
          >
            <option value="">Role?</option>
            {roles.map((role) => (
              <option value={role} key={role}>
                {formatRole(role)}
              </option>
            ))}
          </select>
          <select
            aria-label={`${title} slot ${player.cellId} champion`}
            value={player.champion?.id ?? 0}
            onChange={(event) => {
              const championId = Number(event.target.value);

              onCommand(
                championId > 0
                  ? {
                      type: "setPick",
                      side: player.side,
                      cellId: player.cellId,
                      championId,
                      pickState:
                        player.pickState === "empty" ? "hovering" : player.pickState,
                    }
                  : {
                      type: "clearPick",
                      side: player.side,
                      cellId: player.cellId,
                    },
              );
            }}
          >
            <option value={0}>No champion</option>
            {champions.map((champion) => (
              <option value={champion.id} key={champion.id}>
                {champion.name}
              </option>
            ))}
          </select>
          <select
            aria-label={`${title} slot ${player.cellId} pick state`}
            value={player.pickState}
            disabled={!player.champion}
            onChange={(event) =>
              player.champion
                ? onCommand({
                    type: "setPick",
                    side: player.side,
                    cellId: player.cellId,
                    championId: player.champion.id,
                    pickState: event.target.value as PickState,
                  })
                : undefined
            }
          >
            <option value="empty">Empty</option>
            <option value="hovering">Hover</option>
            <option value="locked">Lock</option>
          </select>
          <button
            type="button"
            disabled={!player.role}
            aria-label={`${player.side === "enemy" ? "Prepare to counter" : "Recommend for"} ${title.toLowerCase()} slot ${player.cellId}`}
            aria-pressed={player.cellId === targetCellId}
            onClick={() =>
              onCommand({
                type: "setTarget",
                side: player.side,
                cellId: player.cellId,
                role: player.role,
              })
            }
          >
            {player.side === "enemy" ? "Prepare" : "Recommend"}
          </button>
        </div>
      ))}
    </div>
  );
}

function formatRole(role: Role): string {
  return role === "utility" ? "support" : role;
}
