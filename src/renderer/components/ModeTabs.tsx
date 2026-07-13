import type React from "react";

export type DraftMode = "live" | "simulation";

interface ModeTabsProps {
  mode: DraftMode;
  onChange: (mode: DraftMode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps): JSX.Element {
  return (
    <nav className="mode-tabs" aria-label="draft mode" role="tablist">
      <ModeTab label="Live" value="live" mode={mode} onChange={onChange} />
      <ModeTab label="Simulator" value="simulation" mode={mode} onChange={onChange} />
    </nav>
  );
}

function ModeTab({
  label,
  value,
  mode,
  onChange,
}: {
  label: string;
  value: DraftMode;
  mode: DraftMode;
  onChange: (mode: DraftMode) => void;
}): JSX.Element {
  const selected = mode === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="draft-mode-panel"
      tabIndex={selected ? 0 : -1}
      onClick={() => onChange(value)}
      onKeyDown={(event) => handleModeKey(event, value, onChange)}
    >
      {label}
    </button>
  );
}

function handleModeKey(
  event: React.KeyboardEvent<HTMLButtonElement>,
  mode: DraftMode,
  onChange: (mode: DraftMode) => void,
): void {
  const next = nextModeForKey(mode, event.key);

  if (!next) {
    return;
  }

  event.preventDefault();
  onChange(next);
  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
    '[role="tab"]',
  );
  buttons?.[next === "live" ? 0 : 1]?.focus();
}

export function nextModeForKey(mode: DraftMode, key: string): DraftMode | null {
  return key === "ArrowLeft" || key === "ArrowRight"
    ? mode === "live"
      ? "simulation"
      : "live"
    : null;
}
