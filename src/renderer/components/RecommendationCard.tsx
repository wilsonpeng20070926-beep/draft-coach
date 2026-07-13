import { useState } from "react";
import type { FactorBreakdown, Recommendation } from "../../shared/types";
import type { ProEvidenceRecord } from "../../shared/proData";
import {
  formatBreakdownStrength,
  formatContributionSummary,
  formatFactorName,
  formatReasonChip,
  reasonChipFromText,
  sortReasonChips,
} from "../formatters/reasonChips";

interface RecommendationCardProps {
  recommendation: Recommendation;
  rank: number;
}

export function RecommendationCard({
  recommendation,
  rank,
}: RecommendationCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const percent = Math.round(recommendation.total * 100);
  const structuredReasons = recommendation.contributions.flatMap(
    (contribution) => contribution.reasonChips ?? [],
  );
  const fallbackReasons = recommendation.contributions
    .flatMap((contribution) => contribution.reasons)
    .map(reasonChipFromText);
  const reasons = sortReasonChips(
    structuredReasons.length > 0 ? structuredReasons : fallbackReasons,
  );
  const visibleReasons = expanded ? reasons : reasons.slice(0, 3);
  const hiddenReasonCount = reasons.length - visibleReasons.length;
  const breakdown = collectBreakdown(recommendation);
  const proEvidence = collectProEvidence(recommendation);

  return (
    <li className="recommendation-card" data-expanded={expanded}>
      <div className="recommendation-rank">{rank}</div>
      <img
        className="champion-icon"
        src={recommendation.champion.iconUrl}
        alt=""
        loading="lazy"
      />
      <div className="recommendation-copy">
        <div className="recommendation-title">
          <span>{recommendation.champion.name}</span>
          <div className="title-actions">
            <strong>{percent}</strong>
            <button
              className="why-button"
              type="button"
              aria-expanded={expanded}
              aria-label={`Explain ${recommendation.champion.name}`}
              onClick={() => setExpanded((value) => !value)}
            >
              Why
            </button>
          </div>
        </div>
        <div className="score-track" aria-label={`score ${percent}`}>
          <div className="score-fill" style={{ width: `${percent}%` }} />
        </div>
        {recommendation.risk ? (
          <div className="risk-summary" data-label={recommendation.risk.label}>
            <b>{recommendation.risk.label}</b>
            <span>{recommendation.risk.reasons[0]}</span>
          </div>
        ) : null}
        {reasons.length > 0 ? (
          <div className="reason-list">
            {visibleReasons.map((reason, index) => {
              const formatted = formatReasonChip(reason);

              return (
                <span
                  className={formatted.className}
                  key={`${reason.kind}-${reason.text}-${index}`}
                  title={formatted.label}
                >
                  <b>{formatted.icon}</b>
                  {formatted.text}
                </span>
              );
            })}
            {hiddenReasonCount > 0 ? (
              <span className="reason-chip reason-chip-overflow">
                +{hiddenReasonCount}
              </span>
            ) : null}
          </div>
        ) : null}
        {expanded ? (
          <div className="why-details">
            <div className="factor-decomposition" aria-label="score decomposition">
              {recommendation.contributions.map((contribution) => (
                <span key={contribution.factor}>
                  {formatContributionSummary(contribution)}
                </span>
              ))}
            </div>
            {breakdown.length > 0 ? (
              <div className="breakdown-list" aria-label="factor breakdown">
                {breakdown.map((entry, index) => (
                  <div
                    className="breakdown-row"
                    data-polarity={entry.polarity ?? "neutral"}
                    key={`${entry.kind}-${entry.label}-${index}`}
                  >
                    <span>{entry.label}</span>
                    <strong>{formatBreakdownMetric(entry)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {proEvidence.length > 0 ? (
              <div className="pro-evidence-list" aria-label="professional evidence details">
                {proEvidence.map((evidence) => (
                  <div key={`${evidence.kind}-${evidence.text}`}>
                    <b>{evidence.text}</b>
                    <span>{formatExactProEvidence(evidence)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function collectProEvidence(recommendation: Recommendation): ProEvidenceRecord[] {
  return [...new Map(
    recommendation.contributions
      .flatMap((contribution) => contribution.proEvidence ?? [])
      .map((evidence) => [`${evidence.kind}|${evidence.text}`, evidence]),
  ).values()]
    .sort(
      (left, right) =>
        Number(right.material) - Number(left.material) ||
        right.confidence - left.confidence ||
        left.kind.localeCompare(right.kind),
    )
    .slice(0, 5);
}

export function formatExactProEvidence(evidence: ProEvidenceRecord): string {
  const coverage = [
    evidence.patches.length > 0 ? `patches ${evidence.patches.join(", ")}` : null,
    evidence.competitions.length > 0
      ? evidence.competitions.join(", ")
      : null,
    evidence.teams.length > 0 ? `teams ${evidence.teams.join(", ")}` : null,
  ].filter((item): item is string => Boolean(item));

  return [
    `effective n ${formatNumber(evidence.effectiveSample)}`,
    `${Math.round(evidence.confidence * 100)}% confidence`,
    `${evidence.ageDays}d old`,
    ...coverage,
  ].join(" · ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function collectBreakdown(recommendation: Recommendation): FactorBreakdown[] {
  return recommendation.contributions
    .flatMap((contribution) => contribution.breakdown ?? [])
    .filter((entry) =>
      entry.kind === "synergy" || entry.kind === "team-counter" || entry.kind === "comp-fit",
    )
    .sort((left, right) => (right.strength ?? 0) - (left.strength ?? 0))
    .slice(0, 5);
}

function formatBreakdownMetric(entry: FactorBreakdown): string {
  if (entry.kind === "synergy") {
    return `${Math.round(entry.value * 100)}`;
  }

  if (entry.kind === "comp-fit") {
    return `+${Math.round(entry.value * 100)}`;
  }

  if (entry.kind === "team-counter") {
    return formatBreakdownStrength(entry.value);
  }

  return formatFactorName(entry.kind);
}
