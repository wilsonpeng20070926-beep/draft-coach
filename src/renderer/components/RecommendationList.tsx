import type { RecommendationUpdate } from "../../shared/types";
import { RecommendationCard } from "./RecommendationCard";

interface RecommendationListProps {
  update: RecommendationUpdate;
}

export function RecommendationList({ update }: RecommendationListProps): JSX.Element {
  return (
    <section className="recommendation-panel" aria-label="champion recommendations">
      <div className="strip-header">
        <h2>Recommendations</h2>
        {update.loading ? <span>Loading</span> : <span>{update.recommendations.length}</span>}
      </div>

      {update.limitedDataNote ? <p className="limited-note">{update.limitedDataNote}</p> : null}

      {update.loading ? <LoadingRows /> : null}

      {!update.loading && update.recommendations.length > 0 ? (
        <ol className="recommendation-list">
          {update.recommendations.map((recommendation, index) => (
            <RecommendationCard
              key={recommendation.champion.id}
              recommendation={recommendation}
              rank={index + 1}
            />
          ))}
        </ol>
      ) : null}

      {!update.loading && update.recommendations.length === 0 ? (
        <p className="empty-note">Pick intent appears once your role is known.</p>
      ) : null}
    </section>
  );
}

function LoadingRows(): JSX.Element {
  return (
    <div className="recommendation-loading" aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  );
}
