import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_APP_CONFIG,
  FACTOR_WEIGHT_PRESETS,
  RANK_OPTIONS,
  REGION_OPTIONS,
  type AppConfig,
  type AppConfigPatch,
  mergeAppConfig,
} from "../../shared/config";
import { APP_NAME, APP_VERSION, RIOT_DISCLAIMER } from "../../shared/appInfo";
import type { ProDataStatus } from "../../shared/proData";
import { ProDataStatusPanel } from "./ProDataStatusPanel";

interface SettingsPanelProps {
  config: AppConfig;
  saving: boolean;
  onChange: (patch: AppConfigPatch) => void;
  onClose: () => void;
  proDataStatus: ProDataStatus | null;
  onRefreshProData: () => void;
}

const presets: Array<{ label: string; weights: AppConfig["weights"] }> = [
  { label: "Coach", weights: FACTOR_WEIGHT_PRESETS.coach },
  { label: "Trust the meta", weights: FACTOR_WEIGHT_PRESETS.trustTheMeta },
  { label: "Lane bully", weights: FACTOR_WEIGHT_PRESETS.laneBully },
  { label: "Team comp", weights: FACTOR_WEIGHT_PRESETS.teamComp },
];

export function SettingsPanel({
  config,
  saving,
  onChange,
  onClose,
  proDataStatus,
  onRefreshProData,
}: SettingsPanelProps): JSX.Element {
  const [draftConfig, setDraftConfig] = useState(config);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftConfigRef = useRef(config);
  const pendingPatchRef = useRef<AppConfigPatch | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [favoriteInput, setFavoriteInput] = useState(config.favoriteTeams.join(", "));

  useEffect(() => {
    draftConfigRef.current = config;
    setDraftConfig(config);
    setFavoriteInput(config.favoriteTeams.join(", "));
  }, [config]);

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const updateDraft = (patch: AppConfigPatch, debounce = false): void => {
    const nextConfig = mergeAppConfig(draftConfigRef.current, patch);
    draftConfigRef.current = nextConfig;
    setDraftConfig(nextConfig);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (debounce) {
      pendingPatchRef.current = mergePatches(pendingPatchRef.current, patch);
      debounceRef.current = setTimeout(() => {
        const pendingPatch = pendingPatchRef.current;
        pendingPatchRef.current = null;

        if (pendingPatch) {
          onChange(pendingPatch);
        }
      }, 120);
      return;
    }

    const immediatePatch = mergePatches(pendingPatchRef.current, patch);
    pendingPatchRef.current = null;
    onChange(immediatePatch);
  };
  const weightsTotal =
    draftConfig.weights.meta +
    draftConfig.weights.laneCounter +
    draftConfig.weights.teamCounter +
    draftConfig.weights.synergy +
    draftConfig.weights.compFit;
  const commitFavorites = (): void => {
    updateDraft({ favoriteTeams: parseFavoriteTeams(favoriteInput) });
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <aside
        className="settings-panel"
        aria-label="settings panel"
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Tuning</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close settings" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <section className="settings-section" aria-label="professional evidence settings">
          <div className="section-title">
            <span>Professional evidence</span>
            <strong>{draftConfig.proEvidenceEnabled ? "On" : "Off"}</strong>
          </div>
          <label className="toggle-row">
            <span>Use professional data</span>
            <input
              type="checkbox"
              checked={draftConfig.proEvidenceEnabled}
              onChange={(event) =>
                updateDraft({ proEvidenceEnabled: event.target.checked })
              }
            />
          </label>
          <WeightSlider
            label="Pro influence"
            value={draftConfig.proInfluence}
            onChange={(value) => updateDraft({ proInfluence: value }, true)}
          />
          <label className="favorite-team-field">
            <span>Favorite teams</span>
            <input
              type="text"
              value={favoriteInput}
              placeholder="T1, Bilibili Gaming"
              aria-describedby="favorite-team-help"
              onChange={(event) => setFavoriteInput(event.target.value)}
              onBlur={commitFavorites}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <p className="settings-note" id="favorite-team-help">
            Optional, comma-separated. Favorites shape Pro-inspired and simulator strategy context.
          </p>
          <ProDataStatusPanel
            status={proDataStatus}
            onRefresh={onRefreshProData}
          />
        </section>

        <section className="settings-section" aria-label="factor weights">
          <div className="section-title">
            <span>Advanced ranked balance</span>
            {saving ? <strong>Saving</strong> : null}
          </div>
          <div className="weight-cluster">
            <span className="cluster-title">Meta anchor</span>
            <WeightSlider
              label="Meta"
              value={draftConfig.weights.meta}
              onChange={(value) => updateDraft({ weights: { meta: value } }, true)}
            />
          </div>
          <div className="weight-cluster">
            <span className="cluster-title">Draft-aware factors</span>
            <WeightSlider
              label="Lane"
              value={draftConfig.weights.laneCounter}
              onChange={(value) => updateDraft({ weights: { laneCounter: value } }, true)}
            />
            <WeightSlider
              label="Team"
              value={draftConfig.weights.teamCounter}
              onChange={(value) => updateDraft({ weights: { teamCounter: value } }, true)}
            />
            <WeightSlider
              label="Synergy"
              value={draftConfig.weights.synergy}
              onChange={(value) => updateDraft({ weights: { synergy: value } }, true)}
            />
            <WeightSlider
              label="Comp fit"
              value={draftConfig.weights.compFit}
              onChange={(value) => updateDraft({ weights: { compFit: value } }, true)}
            />
          </div>
          {weightsTotal === 0 ? (
            <p className="settings-note">Meta fallback is active while all weights are zero.</p>
          ) : null}
          <div className="preset-row">
            {presets.map((preset) => (
              <button
                key={preset.label}
                className="preset-button"
                data-primary={preset.label === "Coach"}
                type="button"
                onClick={() => updateDraft({ weights: preset.weights })}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section" aria-label="data settings">
          <div className="field-grid">
            <label>
              <span>Region</span>
              <select
                value={draftConfig.region}
                onChange={(event) => updateDraft({ region: event.target.value })}
              >
                {REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Rank</span>
              <select
                value={draftConfig.rank}
                onChange={(event) => updateDraft({ rank: event.target.value })}
              >
                {RANK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section" aria-label="recommendation settings">
          <NumberField
            label="Top N"
            min={3}
            max={10}
            step={1}
            value={draftConfig.topN}
            onChange={(value) => updateDraft({ topN: value })}
          />
          <NumberField
            label="Pick floor"
            min={0}
            max={5}
            step={0.1}
            value={draftConfig.pickRateFloor * 100}
            suffix="%"
            onChange={(value) => updateDraft({ pickRateFloor: value / 100 })}
          />
          <NumberField
            label="Shrink K"
            min={0}
            max={10000}
            step={100}
            value={draftConfig.shrinkK}
            onChange={(value) => updateDraft({ shrinkK: value })}
          />
          <NumberField
            label="Chip confidence"
            min={0}
            max={100}
            step={1}
            value={draftConfig.minChipConfidence * 100}
            suffix="%"
            onChange={(value) => updateDraft({ minChipConfidence: value / 100 })}
          />
        </section>

        <section className="settings-section about-section" aria-label="about and legal">
          <div className="section-title">
            <span>About</span>
            <strong>{APP_VERSION}</strong>
          </div>
          <dl className="legal-list">
            <div>
              <dt>Mode</dt>
              <dd>Read-only League client companion</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>Local LCU, Data Dragon, ranked signals, and optional pro snapshots</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Settings and caches stay in app data</dd>
            </div>
          </dl>
          <p className="settings-note">{RIOT_DISCLAIMER}</p>
          <p className="settings-note">
            {APP_NAME} does not lock champions, automate gameplay, or inject into League.
          </p>
        </section>

        <button
          className="reset-button"
          type="button"
          onClick={() => updateDraft(DEFAULT_APP_CONFIG)}
        >
          Reset to defaults
        </button>
      </aside>
    </div>
  );
}

export function parseFavoriteTeams(value: string): string[] {
  return [...new Set(
    value
      .split(",")
      .map((team) => team.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function mergePatches(base: AppConfigPatch | null, patch: AppConfigPatch): AppConfigPatch {
  const weights =
    base?.weights || patch.weights
      ? {
          ...(base?.weights ?? {}),
          ...(patch.weights ?? {}),
        }
      : undefined;

  return {
    ...(base ?? {}),
    ...patch,
    ...(weights ? { weights } : {}),
  };
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  const percent = Math.round(value * 100);

  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <strong>{percent}</strong>
    </label>
  );
}

function NumberField({
  label,
  min,
  max,
  step,
  value,
  suffix = "",
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="number-row">
      <span>{label}</span>
      <div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isInteger(value) ? value : value.toFixed(1)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
    </svg>
  );
}
