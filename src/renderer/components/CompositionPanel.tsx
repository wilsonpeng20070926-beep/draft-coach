import { useState } from "react";
import type { TeamContextProjection } from "../../shared/types";

interface CompositionPanelProps {
  context: TeamContextProjection | null;
}

export function CompositionPanel({ context }: CompositionPanelProps): JSX.Element | null {
  const [open, setOpen] = useState(true);

  if (!context) {
    return null;
  }

  const adPercent = Math.round(context.allyDamage.ad * 100);
  const apPercent = Math.round(context.allyDamage.ap * 100);

  return (
    <section className="composition-panel" data-collapsed={!open} aria-label="composition readout">
      <button
        className="composition-header"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Composition</span>
        <strong>{Math.round(context.confidence * 100)}%</strong>
      </button>

      {open ? (
        <div className="composition-body">
          <div className="damage-readout">
            <div className="damage-row">
              <span>AD {adPercent}</span>
              <span>AP {apPercent}</span>
            </div>
            <div
              className="damage-bar"
              data-empty={context.allyDamage.knownCount === 0}
              aria-label={`ally damage mix ${adPercent} AD ${apPercent} AP`}
            >
              <span className="damage-ad" style={{ width: `${adPercent}%` }} />
              <span className="damage-ap" style={{ width: `${apPercent}%` }} />
            </div>
          </div>

          {context.needs.length > 0 ? (
            <div className="comp-badge-row" aria-label="team needs">
              {context.needs.map((need) => (
                <span
                  className="comp-badge"
                  data-satisfied={need.satisfied}
                  key={`${need.kind}-${need.satisfied}`}
                >
                  <b>{need.satisfied ? "OK" : "Need"}</b>
                  {formatNeedKind(need.kind)}
                </span>
              ))}
            </div>
          ) : (
            <p className="composition-empty">No clear ally gaps yet.</p>
          )}

          {context.enemyThreats.length > 0 ? (
            <div className="threat-row" aria-label="enemy threats">
              {context.enemyThreats.map((threat) => (
                <span className="threat-chip" key={threat.kind}>
                  <b>!</b>
                  {formatThreatKind(threat.kind)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatNeedKind(kind: string): string {
  if (kind === "ap" || kind === "ad" || kind === "cc") {
    return kind.toUpperCase();
  }

  return kind.replace(/-/g, " ");
}

function formatThreatKind(kind: string): string {
  if (kind === "burst-ap") {
    return "AP burst";
  }

  if (kind === "burst-ad") {
    return "AD burst";
  }

  return kind.replace(/-/g, " ");
}
