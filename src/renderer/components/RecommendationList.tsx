import { useEffect, useState } from "react";
import type {
  AnticipatedThreat,
  DraftTarget,
  PickEvaluation,
  RecommendationUpdate,
  RecommendationCategory,
} from "../../shared/types";
import { RecommendationCard, formatExactProEvidence } from "./RecommendationCard";

interface RecommendationListProps {
  update: RecommendationUpdate;
  onSelectTarget: (cellId: number) => void;
  onPinThreat?: (threat: AnticipatedThreat) => void;
  onRemoveThreat?: (threat: AnticipatedThreat) => void;
}

export function RecommendationList({
  update,
  onSelectTarget,
  onPinThreat,
  onRemoveThreat,
}: RecommendationListProps): JSX.Element {
  const preparingThreats = update.target?.purpose === "anticipate";
  const [activeCategoryKey, setActiveCategoryKey] = useState("overall");
  const [stableCategories, setStableCategories] = useState<RecommendationCategory[]>([]);
  const [stableRecommendations, setStableRecommendations] = useState(
    update.recommendations,
  );
  const [stableBalance, setStableBalance] = useState(update.evidenceBalance);
  const [stableEvaluation, setStableEvaluation] = useState(update.evaluation);

  useEffect(() => {
    if (!update.loading) {
      setStableCategories(update.categories);
      setStableRecommendations(update.recommendations);
      setStableBalance(update.evidenceBalance);
      setStableEvaluation(update.evaluation);
    }
  }, [
    update.categories,
    update.evaluation,
    update.evidenceBalance,
    update.loading,
    update.recommendations,
  ]);

  const displayCategories = update.loading ? stableCategories : update.categories;
  const displayRecommendations = update.loading
    ? stableRecommendations
    : update.recommendations;
  const activeCategory =
    displayCategories.find((category) => category.key === activeCategoryKey) ??
    displayCategories.find((category) => category.key === "overall") ??
    null;
  const visibleRecommendations = activeCategory?.recommendations ?? displayRecommendations;
  const displayBalance = update.loading ? stableBalance : update.evidenceBalance;
  const displayEvaluation = update.loading ? stableEvaluation : update.evaluation;

  useEffect(() => {
    if (
      displayCategories.length > 0 &&
      !displayCategories.some((category) => category.key === activeCategoryKey)
    ) {
      setActiveCategoryKey(
        displayCategories.find((category) => category.key === "overall")?.key ??
          displayCategories[0].key,
      );
    }
  }, [activeCategoryKey, displayCategories]);

  return (
    <section
      className="recommendation-panel"
      aria-label="champion recommendations"
      aria-busy={update.loading}
    >
      <div className="strip-header">
        <h2>Recommendations</h2>
        {update.loading ? <span>Updating</span> : <span>{visibleRecommendations.length}</span>}
      </div>

      {update.targets.length > 1 ? (
        <div className="target-tabs" role="tablist" aria-label="active allied pickers">
          {update.targets.map((target) => (
            <button
              key={targetKey(target)}
              type="button"
              role="tab"
              aria-selected={update.target?.cellId === target.cellId}
              tabIndex={update.target?.cellId === target.cellId ? 0 : -1}
              onClick={() => onSelectTarget(target.cellId)}
              onKeyDown={(event) => handleTabKey(event, update.targets.length)}
            >
              {formatTargetLabel(target)}
            </button>
          ))}
        </div>
      ) : null}

      {displayCategories.length > 1 ? (
        <div className="category-tabs" role="tablist" aria-label="recommendation categories">
          {displayCategories.map((category) => {
            const selected = activeCategory?.key === category.key;
            return (
              <button
                type="button"
                role="tab"
                key={category.key}
                aria-selected={selected}
                aria-controls="recommendation-category-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveCategoryKey(category.key)}
                onKeyDown={(event) => {
                  const next = handleTabKey(event, displayCategories.length);
                  if (next !== null) {
                    setActiveCategoryKey(displayCategories[next].key);
                  }
                }}
              >
                {category.label}
                <span>{category.recommendations.length}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {visibleRecommendations.length > 0 ? (
        <p className="evidence-balance" aria-label="ranked and professional evidence balance">
          {displayBalance.rankedPercent}% ranked / {displayBalance.proPercent}% pro evidence
        </p>
      ) : null}

      {update.limitedDataNote ? <p className="limited-note">{update.limitedDataNote}</p> : null}

      {update.loading && visibleRecommendations.length === 0 ? <LoadingRows /> : null}

      {update.threats.length > 0 ? (
        <ThreatList
          threats={update.threats}
          preparing={preparingThreats}
          onPin={onPinThreat}
          onRemove={onRemoveThreat}
        />
      ) : null}

      {displayEvaluation ? (
        <EvaluationSummary evaluation={displayEvaluation} />
      ) : null}

      {visibleRecommendations.length > 0 ? (
        <ol
          className="recommendation-list"
          id="recommendation-category-panel"
          role="tabpanel"
          data-updating={update.loading}
        >
          {visibleRecommendations.map((recommendation, index) => (
            <RecommendationCard
              key={recommendation.champion.id}
              recommendation={recommendation}
              rank={index + 1}
            />
          ))}
        </ol>
      ) : null}

      {!update.loading && !preparingThreats && !displayEvaluation && visibleRecommendations.length === 0 ? (
        <p className="empty-note">Pick intent appears once your role is known.</p>
      ) : null}
    </section>
  );
}

function ThreatList({
  threats,
  preparing,
  onPin,
  onRemove,
}: {
  threats: AnticipatedThreat[];
  preparing: boolean;
  onPin?: (threat: AnticipatedThreat) => void;
  onRemove?: (threat: AnticipatedThreat) => void;
}): JSX.Element {
  return (
    <div className="anticipated-threats" aria-label="hypothetical enemy threats">
      <p>{preparing ? "Prepare to counter" : "Hypothetical threats in scoring"}</p>
      {threats.map((threat) => (
        <div className="anticipated-threat" key={threat.champion.id}>
          <span>
            <b>{threat.champion.name}</b>
            {threat.role ? ` · ${formatRole(threat.role)}` : ""}
            {` · ${Math.round(threat.confidence * 100)}%`}
          </span>
          <em>{threat.evidence?.[0] ?? "Hypothetical"}</em>
          {threat.pinned ? (
            <button
              type="button"
              aria-label={`Remove hypothetical ${threat.champion.name} threat`}
              onClick={() => onRemove?.(threat)}
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Pin hypothetical ${threat.champion.name} threat`}
              onClick={() => onPin?.(threat)}
            >
              Pin
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EvaluationSummary({ evaluation }: { evaluation: PickEvaluation }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="pick-evaluation" data-state={evaluation.state}>
      <div className="pick-evaluation-title">
        <span>{evaluation.state === "locked" ? "Locked pick" : "Evaluate hover"}</span>
        <strong>{evaluation.champion.name} · {Math.round(evaluation.total * 100)}</strong>
      </div>
      <EvaluationRow label="Strengths" items={evaluation.strengths} />
      <EvaluationRow label="Risks" items={evaluation.risks} />
      <EvaluationRow label="Team fit" items={evaluation.teamFit} />
      <button
        className="evaluation-details-button"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide evidence" : "Show evidence"}
      </button>
      {expanded ? (
        <div className="evaluation-evidence">
          {evaluation.evidence.map((item) => (
            <span key={item.factor}>
              {item.reasons[0] ?? item.factor}
            </span>
          ))}
          {evaluation.evidence.flatMap((item) => item.proEvidence ?? []).map((evidence) => (
            <span key={`${evidence.kind}-${evidence.text}`}>
              {evidence.text} · {formatExactProEvidence(evidence)}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function EvaluationRow({ label, items }: { label: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pick-evaluation-row">
      <b>{label}</b>
      <span>{items.slice(0, 2).join(" · ")}</span>
    </div>
  );
}

function targetKey(target: DraftTarget): string {
  return `${target.cellId}-${target.role}-${target.source}`;
}

function formatTargetLabel(target: DraftTarget): string {
  const role = formatRole(target.role);

  return `${role} #${target.cellId}`;
}

function formatRole(role: DraftTarget["role"]): string {
  return role === "utility" ? "Support" : role;
}

function LoadingRows(): JSX.Element {
  return (
    <div className="recommendation-loading" aria-hidden="true">
      <div />
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}

export function nextTabIndex(
  currentIndex: number,
  count: number,
  key: string,
): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (currentIndex + 1) % count;
  if (key === "ArrowLeft") return (currentIndex - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function handleTabKey(
  event: React.KeyboardEvent<HTMLButtonElement>,
  count: number,
): number | null {
  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
    '[role="tab"]',
  );
  const currentIndex = buttons
    ? [...buttons].indexOf(event.currentTarget)
    : -1;
  const nextIndex = nextTabIndex(currentIndex, count, event.key);

  if (nextIndex === null) {
    return null;
  }

  event.preventDefault();
  buttons?.[nextIndex]?.focus();
  buttons?.[nextIndex]?.click();
  return nextIndex;
}
