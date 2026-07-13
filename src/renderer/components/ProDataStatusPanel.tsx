import type { ProDataStatus } from "../../shared/proData";

export function ProDataStatusPanel({
  status,
  onRefresh,
}: {
  status: ProDataStatus | null;
  onRefresh?: () => void;
}): JSX.Element | null {
  if (!status) {
    return null;
  }

  const notice = statusNotice(status);

  return (
    <details
      className="pro-data-status"
      data-state={status.state}
      open={Boolean(notice)}
    >
      <summary>
        <span>{notice ?? statusSummary(status)}</span>
        <b>{status.state === "refreshing" ? "Updating" : "Details"}</b>
      </summary>
      <div className="pro-data-details">
        <span>{status.source ?? "No professional snapshot"}</span>
        <span>{formatStatusAge(status.generatedAt)}</span>
        <span>{status.gameCount > 0 ? `${status.gameCount} games` : "Ranked evidence only"}</span>
        {status.lastError ? <span className="pro-data-error">{status.lastError}</span> : null}
        {onRefresh ? (
          <button
            type="button"
            disabled={status.state === "refreshing" || status.state === "disabled"}
            onClick={onRefresh}
          >
            Refresh professional data
          </button>
        ) : null}
      </div>
    </details>
  );
}

export function statusNotice(status: ProDataStatus): string | null {
  if (status.state === "stale") return "Professional data is stale";
  if (status.state === "ranked-only") return "Ranked-only recommendations";
  if (status.state === "error") return "Professional data unavailable";
  if (status.state === "disabled") return "Professional evidence is disabled";
  return null;
}

export function formatStatusAge(generatedAt: string | null, now = new Date()): string {
  if (!generatedAt) {
    return "No successful update";
  }

  const ageMs = Math.max(0, now.getTime() - Date.parse(generatedAt));
  const minutes = Math.floor(ageMs / 60_000);

  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function statusSummary(status: ProDataStatus): string {
  if (status.state === "refreshing") return "Refreshing professional data";
  return status.source ? `Professional data · ${status.source}` : "Professional data";
}
