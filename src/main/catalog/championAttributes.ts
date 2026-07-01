import type {
  ChampionAttributes,
  ChampionRange,
  DamageStyle,
  PowerCurve,
} from "../../shared/championAttributes";
import type { ChampionRef } from "../../shared/types";
import { championAttributeOverrides } from "./championAttributeOverrides";

export interface ChampionAttributeProvider {
  getAttributes(champion: ChampionRef, damageStyle?: DamageStyle | null): ChampionAttributes;
}

interface TagPrior {
  engage: number;
  peel: number;
  frontline: number;
  poke: number;
  waveclear: number;
  cc: number;
  mobility: number;
  carryPotential: number;
  damageStyle: DamageStyle;
  range: ChampionRange;
  powerCurve: PowerCurve;
}

const tagPriors: Record<string, TagPrior> = {
  Tank: {
    engage: 0.6,
    peel: 0.5,
    frontline: 0.9,
    poke: 0.1,
    waveclear: 0.2,
    cc: 0.8,
    mobility: 0.2,
    carryPotential: 0.2,
    damageStyle: "ad",
    range: "melee",
    powerCurve: "flat",
  },
  Fighter: {
    engage: 0.5,
    peel: 0.3,
    frontline: 0.6,
    poke: 0.2,
    waveclear: 0.3,
    cc: 0.4,
    mobility: 0.4,
    carryPotential: 0.5,
    damageStyle: "ad",
    range: "melee",
    powerCurve: "mid",
  },
  Marksman: {
    engage: 0.1,
    peel: 0.1,
    frontline: 0.1,
    poke: 0.5,
    waveclear: 0.5,
    cc: 0.2,
    mobility: 0.4,
    carryPotential: 0.9,
    damageStyle: "ad",
    range: "ranged",
    powerCurve: "late",
  },
  Mage: {
    engage: 0.2,
    peel: 0.3,
    frontline: 0.1,
    poke: 0.7,
    waveclear: 0.7,
    cc: 0.6,
    mobility: 0.3,
    carryPotential: 0.7,
    damageStyle: "ap",
    range: "ranged",
    powerCurve: "mid",
  },
  Assassin: {
    engage: 0.5,
    peel: 0.1,
    frontline: 0.1,
    poke: 0.2,
    waveclear: 0.3,
    cc: 0.3,
    mobility: 0.8,
    carryPotential: 0.8,
    damageStyle: "hybrid",
    range: "melee",
    powerCurve: "early",
  },
  Support: {
    engage: 0.4,
    peel: 0.8,
    frontline: 0.3,
    poke: 0.4,
    waveclear: 0.4,
    cc: 0.7,
    mobility: 0.3,
    carryPotential: 0.2,
    damageStyle: "ap",
    range: "ranged",
    powerCurve: "flat",
  },
};

const emptyAttributes: Omit<ChampionAttributes, "championId" | "primaryClass"> = {
  damageStyle: "unknown",
  engage: 0,
  peel: 0,
  frontline: 0,
  poke: 0,
  waveclear: 0,
  cc: 0,
  mobility: 0,
  range: "unknown",
  powerCurve: "unknown",
  carryPotential: 0,
  attributeConfidence: 0.25,
};

export function createChampionAttributeProvider(
  patchVersion: string,
  knownDamageStyles: ReadonlyMap<number, DamageStyle> = new Map(),
): ChampionAttributeProvider {
  const cache = new Map<string, ChampionAttributes>();

  return {
    getAttributes(champion, damageStyle) {
      const resolvedDamageStyle = damageStyle ?? knownDamageStyles.get(champion.id) ?? null;
      const cacheKey = `${patchVersion}:${champion.id}:${resolvedDamageStyle ?? "tag-prior"}`;
      const cached = cache.get(cacheKey);

      if (cached) {
        return cached;
      }

      const attributes = deriveChampionAttributes(champion, resolvedDamageStyle);
      cache.set(cacheKey, attributes);
      return attributes;
    },
  };
}

export function deriveChampionAttributes(
  champion: ChampionRef,
  opggDamageStyle?: DamageStyle | null,
): ChampionAttributes {
  const tagDerived = deriveFromTags(champion);
  const override = championAttributeOverrides[champion.id] ?? {};
  const overridden = {
    ...tagDerived,
    ...override,
  };
  const damageStyle = opggDamageStyle ?? overridden.damageStyle;
  const hasTags = champion.tags.some((tag) => tag in tagPriors);
  const hasOverride = champion.id in championAttributeOverrides;

  return {
    championId: champion.id,
    damageStyle,
    engage: clamp01(overridden.engage),
    peel: clamp01(overridden.peel),
    frontline: clamp01(overridden.frontline),
    poke: clamp01(overridden.poke),
    waveclear: clamp01(overridden.waveclear),
    cc: clamp01(overridden.cc),
    mobility: clamp01(overridden.mobility),
    range: overridden.range,
    powerCurve: overridden.powerCurve,
    carryPotential: clamp01(overridden.carryPotential),
    primaryClass: primaryClass(champion),
    attributeConfidence: attributeConfidence({
      hasTags,
      hasOverride,
      hasOpggDamageStyle: !!opggDamageStyle,
    }),
  };
}

function deriveFromTags(champion: ChampionRef): Omit<ChampionAttributes, "championId"> {
  const priors = champion.tags
    .map((tag) => tagPriors[tag])
    .filter((prior): prior is TagPrior => prior !== undefined);

  if (priors.length === 0) {
    return {
      ...emptyAttributes,
      primaryClass: "Unknown",
    };
  }

  const damageStyles = priors.map((prior) => prior.damageStyle);

  return {
    damageStyle: combineDamageStyles(damageStyles),
    engage: maxSignal(priors, "engage"),
    peel: maxSignal(priors, "peel"),
    frontline: maxSignal(priors, "frontline"),
    poke: maxSignal(priors, "poke"),
    waveclear: maxSignal(priors, "waveclear"),
    cc: maxSignal(priors, "cc"),
    mobility: maxSignal(priors, "mobility"),
    range: combineRanges(priors.map((prior) => prior.range)),
    powerCurve: combinePowerCurves(priors.map((prior) => prior.powerCurve)),
    carryPotential: maxSignal(priors, "carryPotential"),
    primaryClass: primaryClass(champion),
    attributeConfidence: 0.7,
  };
}

function primaryClass(champion: ChampionRef): string {
  return champion.tags.find((tag) => tag in tagPriors) ?? "Unknown";
}

function maxSignal(priors: TagPrior[], key: keyof Pick<
  TagPrior,
  "engage" | "peel" | "frontline" | "poke" | "waveclear" | "cc" | "mobility" | "carryPotential"
>): number {
  return Math.max(...priors.map((prior) => prior[key]), 0);
}

function combineDamageStyles(styles: DamageStyle[]): DamageStyle {
  const meaningful = styles.filter((style) => style !== "unknown");

  if (meaningful.length === 0) {
    return "unknown";
  }

  if (meaningful.includes("true")) {
    return "true";
  }

  if (meaningful.includes("hybrid")) {
    return "hybrid";
  }

  const unique = new Set(meaningful);

  return unique.size > 1 ? "hybrid" : meaningful[0];
}

function combineRanges(ranges: ChampionRange[]): ChampionRange {
  const meaningful = ranges.filter((range) => range !== "unknown");

  if (meaningful.length === 0) {
    return "unknown";
  }

  const unique = new Set(meaningful);

  return unique.size > 1 ? "mixed" : meaningful[0];
}

function combinePowerCurves(curves: PowerCurve[]): PowerCurve {
  const priority: Array<Exclude<PowerCurve, "unknown">> = ["late", "mid", "early", "flat"];
  const meaningful = new Set(curves.filter((curve) => curve !== "unknown"));

  for (const curve of priority) {
    if (meaningful.has(curve)) {
      return curve;
    }
  }

  return "unknown";
}

function attributeConfidence(options: {
  hasTags: boolean;
  hasOverride: boolean;
  hasOpggDamageStyle: boolean;
}): number {
  if (!options.hasTags) {
    return 0.25;
  }

  if (options.hasOpggDamageStyle) {
    return options.hasOverride ? 0.95 : 0.9;
  }

  return options.hasOverride ? 0.82 : 0.7;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
