import type { ChampionAttributeProvider } from "../../catalog/championAttributes";
import type { MetaDataSource } from "../../data/metaDataSource";
import type {
  ChampionAttributes,
  CompNeed,
  CompNeedKind,
  TeamContext,
} from "../../../shared/championAttributes";
import type {
  ChampionRef,
  DraftState,
  DraftTarget,
  FactorBreakdown,
  FactorContribution,
  ReasonChip,
  Role,
} from "../../../shared/types";
import type { FactorModule } from "../engine";
import { COMP_FIT_DELTA_SCALE, clamp01 } from "../scoringConstants";

interface NeedMatch {
  need: CompNeed;
  provide: number;
  impact: number;
}

const MIN_COMP_FIT_CHIP_IMPACT = 0.12;
const REDUNDANCY_DELTA_SCALE = 0.1;
const NEED_PROVIDE_LABELS: Record<CompNeedKind, string> = {
  ap: "AP",
  ad: "AD",
  frontline: "frontline",
  engage: "engage",
  peel: "peel",
  cc: "CC",
  waveclear: "waveclear",
  range: "range",
};

export const CANDIDATE_PROVIDES_WEIGHTS = {
  hybridDamage: 0.6,
  trueDamage: 0.5,
  mixedRange: 0.65,
} as const;

export class CompFitModule implements FactorModule {
  readonly key = "compFit";
  readonly enabled = true;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly attributeProvider: ChampionAttributeProvider,
    private readonly getRegion: () => string,
    private readonly getRank: () => string,
  ) {}

  async contribute(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
    ctx: TeamContext,
  ): Promise<FactorContribution> {
    if (ctx.allyNeeds.length === 0) {
      return createCompFitContribution(0, 0, [], []);
    }

    const role = target.role;
    const attributes = await this.loadCandidateAttributes(candidate, role);

    return scoreCandidateCompFit(candidate, attributes, ctx);
  }

  private async loadCandidateAttributes(
    candidate: ChampionRef,
    role: Role | null | undefined,
  ): Promise<ChampionAttributes> {
    if (!role || !this.metaSource.getChampionAnalysis) {
      return this.attributeProvider.getAttributes(candidate);
    }

    const analysis = await this.metaSource.getChampionAnalysis(
      candidate,
      role,
      this.getRegion(),
      this.getRank(),
    );

    return this.attributeProvider.getAttributes(candidate, analysis.damageStyle);
  }
}

export function scoreCandidateCompFit(
  candidate: ChampionRef,
  attributes: ChampionAttributes,
  ctx: TeamContext,
): FactorContribution {
  if (ctx.allyNeeds.length === 0) {
    return createCompFitContribution(0, 0, [], []);
  }

  const matches = ctx.allyNeeds.map((need) => {
    const provide = candidateProvides(need.kind, attributes);

    return {
      need,
      provide,
      impact: provide * need.severity,
    };
  });
  const positiveMatches = matches.filter((match) => match.impact > 0.001);
  const breakdown = positiveMatches.map((match) =>
    createCompFitBreakdown(candidate, match),
  );

  if (positiveMatches.length === 0) {
    const redundancy = strongestDamageRedundancy(ctx.allyNeeds, attributes);

    if (redundancy) {
      const reason: ReasonChip = {
        kind: "comp-fit",
        text: redundancy.text,
        polarity: "negative",
        strength: clamp01(redundancy.impact),
        confidence: clamp01(ctx.confidence),
      };

      return createCompFitContribution(
        -redundancy.impact * REDUNDANCY_DELTA_SCALE,
        ctx.confidence,
        [reason],
        breakdown,
      );
    }

    return createCompFitContribution(0, ctx.confidence, [], breakdown);
  }

  const rawFit = diminishingFit(positiveMatches);
  const delta = rawFit * COMP_FIT_DELTA_SCALE;
  const confidence = clamp01(ctx.confidence);
  const reason = createBestCompFitReason(positiveMatches, confidence);

  return createCompFitContribution(
    delta,
    confidence,
    reason ? [reason] : [],
    breakdown,
  );
}

function strongestDamageRedundancy(
  needs: CompNeed[],
  attributes: ChampionAttributes,
): { impact: number; text: string } | null {
  const candidates = needs.flatMap((need) => {
    if (need.kind === "ap" && damageProvides(attributes.damageStyle, "ad") >= 0.8) {
      return [{ impact: need.severity, text: "Adds more AD to an AD-heavy team" }];
    }

    if (need.kind === "ad" && damageProvides(attributes.damageStyle, "ap") >= 0.8) {
      return [{ impact: need.severity, text: "Adds more AP to an AP-heavy team" }];
    }

    return [];
  });

  return candidates.sort((left, right) => right.impact - left.impact)[0] ?? null;
}

export function candidateProvides(
  needKind: CompNeedKind,
  attributes: ChampionAttributes,
): number {
  if (needKind === "ap") {
    return damageProvides(attributes.damageStyle, "ap");
  }

  if (needKind === "ad") {
    return damageProvides(attributes.damageStyle, "ad");
  }

  if (needKind === "frontline") {
    return attributes.frontline;
  }

  if (needKind === "engage") {
    return attributes.engage;
  }

  if (needKind === "peel") {
    return attributes.peel;
  }

  if (needKind === "cc") {
    return attributes.cc;
  }

  if (needKind === "waveclear") {
    return attributes.waveclear;
  }

  if (attributes.range === "ranged") {
    return 1;
  }

  if (attributes.range === "mixed") {
    return CANDIDATE_PROVIDES_WEIGHTS.mixedRange;
  }

  return 0;
}

function damageProvides(
  damageStyle: ChampionAttributes["damageStyle"],
  needed: "ad" | "ap",
): number {
  if (damageStyle === needed) {
    return 1;
  }

  if (damageStyle === "hybrid") {
    return CANDIDATE_PROVIDES_WEIGHTS.hybridDamage;
  }

  if (damageStyle === "true") {
    return CANDIDATE_PROVIDES_WEIGHTS.trueDamage;
  }

  return 0;
}

function diminishingFit(matches: NeedMatch[]): number {
  return clamp01(1 - matches.reduce((remaining, match) => remaining * (1 - match.impact), 1));
}

function createBestCompFitReason(
  matches: NeedMatch[],
  confidence: number,
): ReasonChip | null {
  const best = [...matches].sort((left, right) => right.impact - left.impact)[0];

  if (!best || best.impact < MIN_COMP_FIT_CHIP_IMPACT) {
    return null;
  }

  return {
    kind: "comp-fit",
    text: formatCompFitReason(best.need.kind),
    polarity: "positive",
    strength: clamp01(best.impact),
    confidence,
  };
}

function createCompFitBreakdown(
  candidate: ChampionRef,
  match: NeedMatch,
): FactorBreakdown {
  return {
    kind: "comp-fit",
    label: `Provides ${NEED_PROVIDE_LABELS[match.need.kind]}`,
    value: clamp01(match.impact),
    confidence: clamp01(match.provide),
    polarity: "positive",
    strength: clamp01(match.impact),
    championId: candidate.id,
    championName: candidate.name,
  };
}

function formatCompFitReason(kind: CompNeedKind): string {
  if (kind === "ap") {
    return "Adds AP to an AD-heavy team";
  }

  if (kind === "ad") {
    return "Adds AD to an AP-heavy team";
  }

  return `Adds ${NEED_PROVIDE_LABELS[kind]} to the team`;
}

function createCompFitContribution(
  delta: number,
  confidence: number,
  reasons: ReasonChip[],
  breakdown: FactorBreakdown[],
): FactorContribution {
  return {
    factor: "compFit",
    delta,
    confidence,
    reasons,
    breakdown,
  };
}
