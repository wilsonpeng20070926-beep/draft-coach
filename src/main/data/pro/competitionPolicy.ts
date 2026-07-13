import type { CompetitionTier } from "../../../shared/proData";

const excludedCompetitionPattern =
  /academy|challenger|development|collegiate|university|nacl|erl|prime league|ultraliga|superliga|emerging/i;
const internationalPattern =
  /world championship|worlds|mid-season invitational|\bmsi\b|first stand|esports world cup|\bewc\b/i;
const majorPattern = /\b(lck|lpl|lec|lcs)\b/i;
const includedPattern = /\b(lcp|cblol)\b/i;

export function classifyProCompetition(name: string): CompetitionTier | null {
  if (!name || excludedCompetitionPattern.test(name)) {
    return null;
  }

  if (internationalPattern.test(name)) {
    return "international";
  }

  if (majorPattern.test(name)) {
    return "major";
  }

  return includedPattern.test(name) ? "included" : null;
}
