import type { MetaDataSource } from "../../data/metaDataSource";
import type { TeamContext } from "../../../shared/championAttributes";
import type {
  ChampionRef,
  DraftState,
  FactorContribution,
  ReasonChip,
} from "../../../shared/types";
import type { FactorModule } from "../engine";
import { COUNTER_DELTA_SCALE, clamp01 } from "../scoringConstants";

export class CounterModule implements FactorModule {
  readonly key = "laneCounter";
  readonly enabled = true;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly getRegion: () => string,
    private readonly getRank: () => string,
    private readonly getMinChipConfidence: () => number,
  ) {}

  async contribute(
    candidate: ChampionRef,
    draft: DraftState,
    _ctx: TeamContext,
  ): Promise<FactorContribution> {
    const role = draft.localPlayer?.role;
    const laneOpponent = draft.laneOpponent;
    const opponent = laneOpponent?.champion;

    if (!role || !opponent) {
      return createCounterContribution(0, 0, []);
    }

    const matchup = await this.metaSource.getMatchup(
      candidate,
      opponent,
      role,
      this.getRegion(),
      this.getRank(),
    );

    if (matchup.winRate === null) {
      return createCounterContribution(0, 0, []);
    }

    const confidence = laneOpponent.roleConfidence ?? 1;
    const rawScore = mapMatchupWinRate(matchup.winRate);
    const delta = (rawScore - 0.5) * 2 * COUNTER_DELTA_SCALE;
    const reasonChip =
      confidence >= this.getMinChipConfidence()
        ? createMatchupReason(opponent.name, matchup.winRate, confidence, laneOpponent.roleSource)
        : null;

    return createCounterContribution(
      delta,
      confidence,
      reasonChip ? [reasonChip] : [],
    );
  }
}

export function mapMatchupWinRate(winRate: number): number {
  return clamp01((winRate - 0.42) / 0.16);
}

function createCounterContribution(
  delta: number,
  confidence: number,
  reasons: ReasonChip[],
): FactorContribution {
  return {
    factor: "laneCounter",
    delta,
    confidence,
    reasons,
  };
}

function createMatchupReason(
  opponentName: string,
  winRate: number,
  confidence: number,
  roleSource: "assigned" | "inferred" | undefined,
): ReasonChip {
  const polarity = winRate >= 0.525 ? "positive" : winRate <= 0.475 ? "negative" : "neutral";
  const percent = `${Math.round(winRate * 100)}%`;
  const strength = clamp01(Math.abs(mapMatchupWinRate(winRate) - 0.5) * 2);
  const text = formatMatchupReasonText(opponentName, winRate, confidence, roleSource, percent);

  return {
    kind: "lane-counter",
    text,
    polarity,
    strength,
    confidence,
  };
}

function formatMatchupReasonText(
  opponentName: string,
  winRate: number,
  confidence: number,
  roleSource: "assigned" | "inferred" | undefined,
  percent: string,
): string {
  if (roleSource === "inferred" && confidence < 0.5) {
    return `Possibly vs ${opponentName} (${percent})`;
  }

  if (roleSource === "inferred" && confidence < 0.85) {
    return `Likely vs ${opponentName} (${percent})`;
  }

  if (winRate >= 0.525) {
    return `Favored vs ${opponentName} (${percent})`;
  }

  if (winRate <= 0.475) {
    return `Risky into ${opponentName} (${percent})`;
  }

  return `Even vs ${opponentName} (${percent})`;
}
