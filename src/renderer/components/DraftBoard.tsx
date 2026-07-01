import type { ChampionRef, DraftPlayer, DraftState } from "../../shared/types";

interface DraftBoardProps {
  draftState: DraftState;
}

function DraftBoard({ draftState }: DraftBoardProps): JSX.Element {
  return (
    <section className="draft-board" aria-label="draft board">
      <div className="teams-grid">
        <TeamColumn
          title="Your team"
          players={draftState.allies}
          laneOpponentCellId={null}
        />
        <TeamColumn
          title="Enemy team"
          players={draftState.enemies}
          laneOpponentCellId={draftState.laneOpponent?.cellId ?? null}
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
}: {
  title: string;
  players: DraftPlayer[];
  laneOpponentCellId: number | null;
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
          />
        ))}
      </ol>
    </div>
  );
}

function PlayerSeat({
  player,
  isLaneOpponent,
}: {
  player: DraftPlayer;
  isLaneOpponent: boolean;
}): JSX.Element {
  const champion = player.champion;

  return (
    <li
      className="player-seat"
      data-local={player.isLocalPlayer}
      data-opponent={isLaneOpponent}
    >
      <ChampionIcon champion={champion} />
      <div className="seat-copy">
        <span className="champion-name">{champion?.name ?? "Not picked"}</span>
        <span
          className="role-label"
          data-role-source={player.roleSource}
          title={player.roleSource === "inferred" ? "Inferred role" : undefined}
        >
          {formatRole(player.role)}
          {player.roleSource === "inferred" ? " ?" : ""}
        </span>
      </div>
      {player.isLocalPlayer ? <span className="seat-badge">You</span> : null}
      {isLaneOpponent ? <span className="seat-badge opponent">vs you</span> : null}
    </li>
  );
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
