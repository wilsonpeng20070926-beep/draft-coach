import type {
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
} from "../../shared/types";

interface DraftBoardProps {
  draftState: DraftState;
  target: DraftTarget | null;
  onSelectAlly: (cellId: number) => void;
  onSelectEnemy?: (cellId: number, role: NonNullable<DraftPlayer["role"]>) => void;
}

function DraftBoard({
  draftState,
  target,
  onSelectAlly,
  onSelectEnemy,
}: DraftBoardProps): JSX.Element {
  const targetOpponent = resolveVisibleLaneOpponent(draftState, target);

  return (
    <section className="draft-board" aria-label="draft board">
      <div className="teams-grid">
        <TeamColumn
          title="Your team"
          players={draftState.allies}
          laneOpponentCellId={null}
          targetCellId={target?.side === "ally" ? target.cellId : null}
          onSelectPlayer={(player) => onSelectAlly(player.cellId)}
        />
        <TeamColumn
          title="Enemy team"
          players={draftState.enemies}
          laneOpponentCellId={targetOpponent?.cellId ?? null}
          targetCellId={target?.side === "enemy" ? target.cellId : null}
          onSelectPlayer={
            onSelectEnemy
              ? (player) => {
                  if (player.role) {
                    onSelectEnemy(player.cellId, player.role);
                  }
                }
              : undefined
          }
        />
      </div>

      <BansStrip bans={draftState.bans} />
    </section>
  );
}

function TeamColumn({
  title,
  players,
  laneOpponentCellId,
  targetCellId,
  onSelectPlayer,
}: {
  title: string;
  players: DraftPlayer[];
  laneOpponentCellId: number | null;
  targetCellId: number | null;
  onSelectPlayer?: (player: DraftPlayer) => void;
}): JSX.Element {
  return (
    <div className="team-column">
      <h2>{title}</h2>
      <ol className="seat-list">
        {players.map((player) => (
          <PlayerSeat
            key={`${title}-${player.cellId}`}
            player={player}
            isLaneOpponent={laneOpponentCellId === player.cellId}
            isTarget={targetCellId === player.cellId}
            onSelect={onSelectPlayer}
          />
        ))}
      </ol>
    </div>
  );
}

function PlayerSeat({
  player,
  isLaneOpponent,
  isTarget,
  onSelect,
}: {
  player: DraftPlayer;
  isLaneOpponent: boolean;
  isTarget: boolean;
  onSelect?: (player: DraftPlayer) => void;
}): JSX.Element {
  const champion = player.champion;

  return (
    <li
      className="player-seat"
      data-local={player.isLocalPlayer}
      data-opponent={isLaneOpponent}
      data-target={isTarget}
      data-pick-state={player.pickState}
    >
      <button
        className="seat-button"
        type="button"
        disabled={!onSelect || (player.side === "enemy" && !player.role)}
        aria-pressed={isTarget}
        aria-label={
          onSelect
            ? player.side === "ally"
              ? `Recommend for ${formatRole(player.role)} ally`
              : `Prepare to counter ${formatRole(player.role)} enemy`
            : undefined
        }
        onClick={() => onSelect?.(player)}
      >
        <ChampionIcon champion={champion} />
        <div className="seat-copy">
          <span className="champion-name">{champion?.name ?? "Not picked"}</span>
          <span
            className="role-label"
            data-role-source={player.roleSource}
            title={player.roleSource === "inferred" ? "Inferred role" : undefined}
          >
            {formatRole(player.role)} · {player.pickState}
            {player.roleSource === "inferred" ? " ?" : ""}
          </span>
        </div>
        {player.isLocalPlayer ? <span className="seat-badge">You</span> : null}
        {isLaneOpponent ? <span className="seat-badge opponent">vs target</span> : null}
      </button>
    </li>
  );
}

function resolveVisibleLaneOpponent(
  draftState: DraftState,
  target: DraftTarget | null,
): DraftPlayer | null {
  if (!target || target.side !== "ally") {
    return null;
  }

  const matches = draftState.enemies.filter(
    (enemy) =>
      enemy.pickState === "locked" &&
      enemy.champion !== null &&
      enemy.role === target.role,
  );

  return matches.length === 1 ? matches[0] : null;
}

function BansStrip({ bans }: { bans: ChampionRef[] }): JSX.Element {
  return (
    <div className="bans-strip">
      <div className="strip-header">
        <h2>Bans</h2>
        <span>{bans.length}</span>
      </div>
      {bans.length > 0 ? (
        <ul className="ban-list">
          {bans.map((champion) => (
            <li className="ban-chip" key={champion.id}>
              <ChampionIcon champion={champion} small />
              <span>{champion.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">No completed bans yet.</p>
      )}
    </div>
  );
}

function ChampionIcon({
  champion,
  small = false,
}: {
  champion: ChampionRef | null;
  small?: boolean;
}): JSX.Element {
  if (!champion) {
    return <div className="champion-icon empty" data-small={small} />;
  }

  return (
    <img
      className="champion-icon"
      data-small={small}
      src={champion.iconUrl}
      alt=""
      loading="lazy"
    />
  );
}

function formatRole(role: DraftPlayer["role"]): string {
  if (!role) {
    return "unassigned";
  }

  return role === "utility" ? "support" : role;
}

export default DraftBoard;
