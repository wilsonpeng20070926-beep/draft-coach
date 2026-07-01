import type { ReasonChip, ReasonKind, ScoreContribution } from "../../shared/types";

export interface FormattedReasonChip {
  icon: string;
  label: string;
  text: string;
  className: string;
}

const KIND_LABELS: Record<ReasonKind, string> = {
  meta: "Meta",
  "lane-counter": "Lane",
  "team-counter": "Team",
  synergy: "Syn",
  "comp-fit": "Fit",
  warning: "Warn",
};

const KIND_ICONS: Record<ReasonKind, string> = {
  meta: "M",
  "lane-counter": "L",
  "team-counter": "T",
  synergy: "S",
  "comp-fit": "C",
  warning: "!",
};

const HEDGE_PATTERN = /^(possible|possibly|likely)\s+/i;
const LIKELY_CONFIDENCE = 0.85;
const POSSIBLY_CONFIDENCE = 0.5;

export function formatReasonChip(chip: ReasonChip): FormattedReasonChip {
  return {
    icon: KIND_ICONS[chip.kind],
    label: KIND_LABELS[chip.kind],
    text: formatHedgedText(chip.text, chip.confidence),
    className: `reason-chip reason-chip-${chip.kind} reason-chip-${chip.polarity}`,
  };
}

export function sortReasonChips(chips: ReasonChip[]): ReasonChip[] {
  return [...chips].sort((left, right) => {
    if (right.strength !== left.strength) {
      return right.strength - left.strength;
    }

    return right.confidence - left.confidence;
  });
}

export function reasonChipFromText(text: string): ReasonChip {
  return {
    kind: "meta",
    text,
    polarity: "neutral",
    strength: 0,
    confidence: 1,
  };
}

export function formatContributionSummary(contribution: ScoreContribution): string {
  if (contribution.factor === "meta") {
    return `Meta ${formatScore(contribution.score)}`;
  }

  const delta = contribution.effectiveDelta ?? (contribution.delta ?? 0) * (contribution.confidence ?? 1);

  return `${formatSignedScore(delta)} ${formatFactorName(contribution.factor)}`;
}

export function formatFactorName(factor: string): string {
  if (factor === "laneCounter" || factor === "counter") {
    return "lane-counter";
  }

  if (factor === "teamCounter") {
    return "team-counter";
  }

  if (factor === "compFit") {
    return "comp-fit";
  }

  return factor;
}

export function formatBreakdownStrength(value: number): string {
  const signed = Math.round(value * 100);

  if (signed > 0) {
    return `+${signed}`;
  }

  return `${signed}`;
}

export function formatHedgedText(text: string, confidence: number): string {
  const base = text.trim().replace(/\s+/g, " ").replace(HEDGE_PATTERN, "");

  if (confidence < POSSIBLY_CONFIDENCE) {
    return `Possibly ${softenFirstWord(base)}`;
  }

  if (confidence < LIKELY_CONFIDENCE) {
    return `Likely ${softenFirstWord(base)}`;
  }

  return base;
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}`;
}

function formatSignedScore(value: number): string {
  const scaled = Math.round(value * 100);

  if (scaled > 0) {
    return `+${scaled}`;
  }

  return `${scaled}`;
}

function softenFirstWord(text: string): string {
  if (text.length < 2) {
    return text.toLowerCase();
  }

  const first = text.charAt(0);
  const second = text.charAt(1);

  if (first === first.toUpperCase() && second === second.toLowerCase()) {
    return first.toLowerCase() + text.slice(1);
  }

  return text;
}
