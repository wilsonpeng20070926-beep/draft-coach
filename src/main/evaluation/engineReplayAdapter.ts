import { buildProDataSnapshot } from "../data/pro/aggregate";
import type { RecommendationEngine } from "../engine/engine";
import type { ProDataSnapshot, ProSide } from "../../shared/proData";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  Recommendation,
  Role,
} from "../../shared/types";
import type {
  ReplayPrediction,
  ReplayPredictor,
  ReplayStepContext,
} from "./draftReplay";
import type { EvaluationConfiguration } from "./evaluationConfigurations";
import { evaluationConfiguration } from "./evaluationConfigurations";

export interface EngineReplayFactoryContext {
  configuration: EvaluationConfiguration;
  trainingSnapshot: ProDataSnapshot;
  replay: ReplayStepContext;
}

export interface EngineReplayAdapterOptions {
  resolveChampion: (championId: number) => ChampionRef | null;
  createEngine: (
    context: EngineReplayFactoryContext,
  ) => RecommendationEngine | Promise<RecommendationEngine>;
  createThreats?: (
    context: ReplayStepContext,
  ) => AnticipatedThreat[] | Promise<AnticipatedThreat[]>;
  estimateTop1Confidence?: (
    recommendations: readonly Recommendation[],
  ) => number | undefined;
}

export function createEngineReplayPredictor(
  options: EngineReplayAdapterOptions,
): ReplayPredictor {
  const snapshotCache = new Map<string, ProDataSnapshot>();

  return async (context): Promise<ReplayPrediction> => {
    const snapshotKey = context.trainingDrafts.map((draft) => draft.gameId).join("|");
    let trainingSnapshot = snapshotCache.get(snapshotKey);
    if (!trainingSnapshot) {
      const generatedAt = context.trainingDrafts.at(-1)?.playedAt;
      if (!generatedAt) {
        throw new Error("Engine replay requires a non-empty training window");
      }
      trainingSnapshot = buildProDataSnapshot([...context.trainingDrafts], {
        generatedAt,
        source: "Offline chronological replay",
        sourceUrl: "local://draft-intelligence-replay",
        attribution: "Evaluation input dataset",
      });
      snapshotCache.set(snapshotKey, trainingSnapshot);
    }

    const configuration = evaluationConfiguration(context.configuration);
    const engine = await options.createEngine({
      configuration,
      trainingSnapshot,
      replay: context,
    });
    const { draft, target } = createReplayDraft(context, options.resolveChampion);
    const threats = (await options.createThreats?.(context)) ?? [];
    const result = await engine.recommend(draft, target, threats);
    const evaluatedRecommendations = uniqueRecommendations([
      ...result.recommendations,
      ...result.categories.flatMap((category) => category.recommendations),
    ]);
    const categories = Object.fromEntries(
      result.categories.map((category) => [
        category.key,
        category.recommendations.map((recommendation) => recommendation.champion.id),
      ]),
    );
    const traceByChampionId = Object.fromEntries(
      evaluatedRecommendations.map((recommendation) => [
        recommendation.champion.id,
        recommendationTrace(recommendation),
      ]),
    );
    const riskProbabilityByChampionId = Object.fromEntries(
      evaluatedRecommendations
        .filter((recommendation) => recommendation.risk)
        .map((recommendation) => [
          recommendation.champion.id,
          riskProbability(recommendation),
        ]),
    );

    return {
      championIds: result.recommendations.map(
        (recommendation) => recommendation.champion.id,
      ),
      categories,
      traceByChampionId,
      riskProbabilityByChampionId,
      top1Confidence: options.estimateTop1Confidence?.(result.recommendations),
    };
  };
}

export function createReplayDraft(
  context: ReplayStepContext,
  resolveChampion: EngineReplayAdapterOptions["resolveChampion"],
): { draft: DraftState; target: DraftTarget } {
  const allySourceSide = context.nextPick.side;
  const allies = replayPlayers(
    context,
    allySourceSide,
    "ally",
    0,
    resolveChampion,
  );
  const enemies = replayPlayers(
    context,
    opposite(allySourceSide),
    "enemy",
    5,
    resolveChampion,
  );
  const targetCellId = roleIndex(context.nextPick.role);
  const targetPlayer = allies.find((player) => player.cellId === targetCellId);

  if (!targetPlayer) {
    allies.push({
      cellId: targetCellId,
      side: "ally",
      role: context.nextPick.role,
      roleSource: "assigned",
      roleConfidence: 1,
      champion: null,
      pickState: "empty",
      isLocalPlayer: false,
    });
    allies.sort((left, right) => left.cellId - right.cellId);
  } else if (targetPlayer.champion) {
    throw new Error(
      `Replay target role ${context.nextPick.role} was already revealed in ${context.heldOutDraft.gameId}`,
    );
  }

  const bans = context.heldOutDraft.bans
    .map((ban) => resolveChampion(ban.championId))
    .filter((champion): champion is ChampionRef => champion !== null);
  const draft: DraftState = {
    phase: "champSelect",
    allies,
    enemies,
    bans,
    pickActions: [],
    activeAllyPickCellIds: [targetCellId],
    localPlayer: null,
  };
  const target: DraftTarget = {
    side: "ally",
    cellId: targetCellId,
    role: context.nextPick.role,
    source: "simulation",
    purpose: "recommend",
  };

  return { draft, target };
}

function replayPlayers(
  context: ReplayStepContext,
  sourceSide: ProSide,
  side: DraftPlayer["side"],
  cellOffset: number,
  resolveChampion: EngineReplayAdapterOptions["resolveChampion"],
): DraftPlayer[] {
  return context.revealedPicks
    .filter((pick) => pick.side === sourceSide)
    .map((pick) => {
      const champion = resolveChampion(pick.championId);
      if (!champion) {
        throw new Error(`Replay champion ${pick.championId} is missing from the catalog`);
      }
      return {
        cellId: cellOffset + roleIndex(pick.role),
        side,
        role: pick.role,
        roleSource: "assigned" as const,
        roleConfidence: 1,
        champion,
        pickState: "locked" as const,
        isLocalPlayer: false,
      };
    })
    .sort((left, right) => left.cellId - right.cellId);
}

function recommendationTrace(recommendation: Recommendation): string[] {
  return [
    ...recommendation.contributions.flatMap((contribution) => contribution.reasons),
    ...(recommendation.risk?.reasons ?? []),
  ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index);
}

function uniqueRecommendations(
  recommendations: readonly Recommendation[],
): Recommendation[] {
  return [
    ...new Map(
      recommendations.map((recommendation) => [
        recommendation.champion.id,
        recommendation,
      ]),
    ).values(),
  ];
}

function riskProbability(recommendation: Recommendation): number {
  const risk = recommendation.risk;
  if (!risk) return 0;
  const base = risk.label === "Avoid" ? 0.85 : risk.label === "High risk" ? 0.7 : 0.58;
  return clamp01(0.5 + (base - 0.5) * risk.confidence);
}

function roleIndex(role: Role): number {
  return ["top", "jungle", "middle", "bottom", "utility"].indexOf(role);
}

function opposite(side: ProSide): ProSide {
  return side === "blue" ? "red" : "blue";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
