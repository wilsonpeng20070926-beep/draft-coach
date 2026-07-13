"use client";

import { useMemo, useState } from "react";

type Category = "overall" | "lane" | "synergy" | "risk";
type Preset = "Coach" | "Draft aware" | "Trust the meta";

type Recommendation = {
  id: string;
  name: string;
  role: string;
  fit: number;
  summary: string;
  chips: string[];
  reasons: { label: string; value: number; detail: string }[];
};

const recommendations: Record<Category, Recommendation[]> = {
  overall: [
    {
      id: "ahri",
      name: "Ahri",
      role: "Mid",
      fit: 82,
      summary: "Safe blind pick with pick pressure and reliable follow-up.",
      chips: ["Balanced damage", "Pairs with Jarvan IV", "Mobile into Syndra"],
      reasons: [
        { label: "Meta anchor", value: 68, detail: "A stable ranked baseline keeps the suggestion grounded." },
        { label: "Lane matchup", value: 76, detail: "Mobility and wave control reduce the exposed lane risk." },
        { label: "Team synergy", value: 89, detail: "Charm creates a clean engage chain after Jarvan IV." },
        { label: "Comp fit", value: 84, detail: "Adds AP damage and dependable catch without forcing a fight." },
      ],
    },
    {
      id: "orianna",
      name: "Orianna",
      role: "Mid",
      fit: 78,
      summary: "High-value teamfight control with a strong engage partner.",
      chips: ["Command: Shockwave", "Front-to-back", "AP balance"],
      reasons: [
        { label: "Meta anchor", value: 73, detail: "Strong general performance in the synthetic patch sample." },
        { label: "Lane matchup", value: 66, detail: "Playable lane, but less forgiving when caught without Flash." },
        { label: "Team synergy", value: 94, detail: "Ball delivery through Jarvan IV is the defining upside." },
        { label: "Comp fit", value: 79, detail: "Adds zone control and sustained AP teamfight damage." },
      ],
    },
    {
      id: "galio",
      name: "Galio",
      role: "Mid",
      fit: 74,
      summary: "Protective counter-engage that makes side-lane plays safer.",
      chips: ["Magic shield", "Global follow-up", "Peel"],
      reasons: [
        { label: "Meta anchor", value: 61, detail: "Lower baseline, retained because the draft fit is unusually clear." },
        { label: "Lane matchup", value: 81, detail: "Durability and shove help absorb Syndra's early pressure." },
        { label: "Team synergy", value: 78, detail: "Hero's Entrance reinforces Jarvan IV after the engage." },
        { label: "Comp fit", value: 88, detail: "Protects Jinx and adds a second reliable crowd-control layer." },
      ],
    },
  ],
  lane: [],
  synergy: [],
  risk: [
    {
      id: "kassadin",
      name: "Kassadin",
      role: "Mid",
      fit: 48,
      summary: "High scaling upside, but the current draft cannot safely cover the lane.",
      chips: ["Early priority risk", "Short-range engage", "Needs time"],
      reasons: [
        { label: "Meta anchor", value: 64, detail: "The baseline is reasonable, but it does not erase draft-specific risk." },
        { label: "Lane matchup", value: 38, detail: "Syndra can punish the short range and contest early objectives." },
        { label: "Team synergy", value: 52, detail: "The allies do not provide enough early cover for the scaling curve." },
        { label: "Comp fit", value: 46, detail: "The team already needs steadier mid-game control." },
      ],
    },
  ],
};

recommendations.lane = [recommendations.overall[0], recommendations.overall[2]];
recommendations.synergy = [recommendations.overall[1], recommendations.overall[0]];

const categoryLabels: { id: Category; label: string }[] = [
  { id: "overall", label: "Best overall" },
  { id: "lane", label: "Lane matchup" },
  { id: "synergy", label: "Best synergy" },
  { id: "risk", label: "Avoid / risk" },
];

const draftSlots = {
  allies: [
    ["Top", "Ornn"],
    ["Jungle", "Jarvan IV"],
    ["Mid", "Your pick"],
    ["Bottom", "Jinx"],
    ["Support", "Thresh"],
  ],
  enemies: [
    ["Top", "Renekton"],
    ["Jungle", "Vi"],
    ["Mid", "Syndra"],
    ["Bottom", "Kai'Sa"],
    ["Support", "Nautilus"],
  ],
};

function scoreFor(recommendation: Recommendation, preset: Preset) {
  const adjustment = preset === "Coach" ? 0 : preset === "Draft aware" ? -2 : recommendation.id === "orianna" ? 3 : -4;
  return Math.max(0, Math.min(99, recommendation.fit + adjustment));
}

export default function Home() {
  const [category, setCategory] = useState<Category>("overall");
  const [selectedId, setSelectedId] = useState("ahri");
  const [preset, setPreset] = useState<Preset>("Coach");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visibleRecommendations = recommendations[category];
  const selected = useMemo(
    () => visibleRecommendations.find((item) => item.id === selectedId) ?? visibleRecommendations[0],
    [selectedId, visibleRecommendations],
  );

  return (
    <main>
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Draft Coach home">
          <span className="brand-mark" aria-hidden="true">DC</span>
          <span>Draft Coach</span>
        </a>
        <div className="nav-links">
          <a href="#demo">Interactive demo</a>
          <a href="#safety">Safety</a>
          <a href="#data">Data sources</a>
          <a className="nav-source" href="https://github.com/wilsonpeng20070926-beep/draft-coach">Source code</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="status-pill"><span /> Version 0.2.0 release candidate</div>
          <p className="eyebrow">A read-only League of Legends draft companion</p>
          <h1>Understand the draft<br />before you lock in.</h1>
          <p className="hero-lede">
            Draft Coach turns the picks you can already see into several explainable options—so you keep the decision and understand the tradeoffs.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#demo">Explore the simulated draft</a>
            <a className="button secondary" href="https://github.com/wilsonpeng20070926-beep/draft-coach">Review the source</a>
          </div>
          <p className="hero-note">Synthetic demo data · no login · no live API requests</p>
        </div>
        <div className="hero-card" aria-label="Product principles">
          <div className="hero-card-head">
            <span className="live-dot" />
            <span>Champ select, explained</span>
            <span className="mono">READ ONLY</span>
          </div>
          <div className="principle-list">
            <div><strong>3–5</strong><span>ranked options, not one command</span></div>
            <div><strong>4</strong><span>traceable draft factors</span></div>
            <div><strong>0</strong><span>automated League actions</span></div>
          </div>
          <div className="signal-line"><span style={{ width: "68%" }} /><span style={{ width: "32%" }} /></div>
          <div className="signal-legend"><span>Ranked baseline</span><span>Draft-aware context</span></div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Product assurances">
        <span>Read-only by design</span>
        <span>Local-first settings</span>
        <span>No automatic telemetry</span>
        <span>Open-source explanations</span>
      </section>

      <section className="demo-section" id="demo">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Interactive product demonstration</p>
            <h2>See how one draft becomes several defensible choices.</h2>
          </div>
          <button className="settings-button" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            {settingsOpen ? "Close coaching settings" : "Open coaching settings"}
          </button>
        </div>

        <div className="demo-disclosure">
          <span className="info-mark" aria-hidden="true">i</span>
          This is a self-contained simulation. Champion names and scores are illustrative; the page never connects to Riot, OP.GG, or Leaguepedia.
        </div>

        {settingsOpen ? (
          <aside className="settings-panel" aria-label="Coaching settings">
            <div>
              <p className="settings-kicker">Coaching style</p>
              <h3>Choose how much the draft may move the baseline.</h3>
            </div>
            <div className="preset-row">
              {(["Coach", "Draft aware", "Trust the meta"] as Preset[]).map((item) => (
                <button key={item} type="button" className={preset === item ? "preset active" : "preset"} onClick={() => setPreset(item)}>{item}</button>
              ))}
            </div>
            <div className="weight-grid" aria-label={`${preset} factor weights`}>
              <FactorBar label="Meta anchor" value={preset === "Trust the meta" ? 88 : preset === "Draft aware" ? 64 : 52} />
              <FactorBar label="Lane counter" value={preset === "Trust the meta" ? 36 : 68} />
              <FactorBar label="Team synergy" value={preset === "Trust the meta" ? 30 : preset === "Draft aware" ? 70 : 82} />
              <FactorBar label="Composition fit" value={preset === "Trust the meta" ? 28 : preset === "Draft aware" ? 72 : 84} />
            </div>
          </aside>
        ) : null}

        <div className="demo-window">
          <div className="window-bar">
            <div className="window-lights" aria-hidden="true"><span /><span /><span /></div>
            <div className="window-title">Draft Coach · Simulated champ select</div>
            <div className="window-state"><span /> Offline fixture</div>
          </div>

          <div className="demo-grid">
            <aside className="draft-panel" aria-label="Visible draft">
              <div className="panel-title"><span>Visible draft</span><small>Mid · your pick</small></div>
              <DraftTeam title="Allies" slots={draftSlots.allies} ally />
              <DraftTeam title="Enemies" slots={draftSlots.enemies} />
              <div className="ban-row"><span>Bans</span><b>Zed</b><b>LeBlanc</b><b>Smolder</b></div>
            </aside>

            <section className="recommendation-panel" aria-label="Recommendations">
              <div className="panel-title recommendation-title">
                <div><span>Recommendations</span><small>{preset} preset · synthetic patch 26.13</small></div>
                <span className="confidence">Confidence limited</span>
              </div>
              <div className="category-tabs" role="tablist" aria-label="Recommendation categories">
                {categoryLabels.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={category === item.id}
                    className={category === item.id ? "active" : ""}
                    onClick={() => { setCategory(item.id); setSelectedId(recommendations[item.id][0].id); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="recommendation-layout">
                <div className="recommendation-list">
                  {visibleRecommendations.map((item, index) => (
                    <button
                      className={selected?.id === item.id ? "recommendation-card selected" : "recommendation-card"}
                      type="button"
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      aria-pressed={selected?.id === item.id}
                    >
                      <span className="rank">{index + 1}</span>
                      <span className="champion-token" aria-hidden="true">{item.name.slice(0, 1)}</span>
                      <span className="recommendation-copy"><strong>{item.name}</strong><small>{item.summary}</small></span>
                      <span className="fit-score"><strong>{scoreFor(item, preset)}</strong><small>fit</small></span>
                    </button>
                  ))}
                </div>
                {selected ? (
                  <article className="why-panel" aria-live="polite">
                    <div className="why-header"><div><p>Why this pick</p><h3>{selected.name}</h3></div><span>{scoreFor(selected, preset)} / 100</span></div>
                    <div className="chip-row">{selected.chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
                    <div className="reason-list">
                      {selected.reasons.map((reason) => (
                        <div className="reason" key={reason.label}>
                          <div className="reason-line"><strong>{reason.label}</strong><span>{reason.value}</span></div>
                          <div className="reason-track"><span style={{ width: `${reason.value}%` }} /></div>
                          <p>{reason.detail}</p>
                        </div>
                      ))}
                    </div>
                    <p className="why-footnote">Scores are relative coaching signals, not win guarantees.</p>
                  </article>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="safety-section" id="safety">
        <div className="section-heading compact">
          <div><p className="eyebrow">Clear boundaries</p><h2>A coach beside the client—not a hand inside it.</h2></div>
        </div>
        <div className="safety-grid">
          <SafetyCard mark="01" title="Reads visible context" body="Uses local champ-select state to reconstruct visible picks, bans, and assigned roles." />
          <SafetyCard mark="02" title="Explains alternatives" body="Shows multiple candidates, uncertainty, positive signals, and risks before you choose." />
          <SafetyCard mark="03" title="Never acts for you" body="Does not select, hover, lock a champion, send chat, or modify gameplay." />
          <SafetyCard mark="04" title="Keeps data local" body="Stores settings and bounded caches on-device. Automatic telemetry is not included." />
        </div>
      </section>

      <section className="data-section" id="data">
        <div className="data-copy">
          <p className="eyebrow">Data-source posture</p>
          <h2>Every signal has a source, a freshness limit, and a fallback.</h2>
          <p>Draft Coach degrades to conservative ranked context when optional evidence is unavailable. It does not turn missing data into false confidence.</p>
          <a href="https://github.com/wilsonpeng20070926-beep/draft-coach/blob/main/docs/DATA_SOURCES.md">Read the complete data-source policy →</a>
        </div>
        <div className="source-ledger">
          <SourceRow status="Available" title="Riot Data Dragon" text="Champion catalog and public static assets." tone="green" />
          <SourceRow status="Review pending" title="OP.GG public MCP" text="Optional ranked, matchup, and synergy context. Public-use clarification requested." tone="amber" />
          <SourceRow status="Disabled" title="Leaguepedia snapshot" text="Professional evidence automation and publishing stay off until API and licensing review." tone="muted" />
          <SourceRow status="Always available" title="Local simulation" text="Privacy-safe draft exploration with no client or network dependency." tone="blue" />
        </div>
      </section>

      <section className="release-section" id="release">
        <div>
          <p className="eyebrow">Release candidate</p>
          <h2>Source-ready. Distribution stays gated until reviewers answer.</h2>
          <p>The Windows and macOS candidates have passed automated quality, packaging, checksum, and launch checks. Public binaries are intentionally withheld while the documented Riot, OP.GG, and Leaguepedia/Fandom reviews are open.</p>
        </div>
        <div className="release-card">
          <div><span>Desktop version</span><strong>0.2.0</strong></div>
          <div><span>Supported builds</span><strong>Windows x64 · macOS arm64</strong></div>
          <div><span>Distribution</span><strong className="pending">Approval pending</strong></div>
          <a className="button secondary full" href="https://github.com/wilsonpeng20070926-beep/draft-coach">Inspect the public repository</a>
        </div>
      </section>

      <footer>
        <div className="footer-brand"><span className="brand-mark" aria-hidden="true">DC</span><strong>Draft Coach</strong></div>
        <p>Draft Coach isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
        <div className="footer-links"><a href="https://github.com/wilsonpeng20070926-beep/draft-coach/blob/main/docs/PRIVACY.md">Privacy</a><a href="https://github.com/wilsonpeng20070926-beep/draft-coach/blob/main/docs/SCORING.md">Scoring</a><a href="https://github.com/wilsonpeng20070926-beep/draft-coach">GitHub</a></div>
      </footer>
    </main>
  );
}

function FactorBar({ label, value }: { label: string; value: number }) {
  return <div className="factor-bar"><div><span>{label}</span><b>{value}</b></div><div className="factor-track"><span style={{ width: `${value}%` }} /></div></div>;
}

function DraftTeam({ title, slots, ally = false }: { title: string; slots: string[][]; ally?: boolean }) {
  return <div className="team-block"><p>{title}</p>{slots.map(([role, champion]) => <div className={champion === "Your pick" ? "draft-slot target" : "draft-slot"} key={`${title}-${role}`}><span className={ally ? "slot-mark ally" : "slot-mark"}>{champion === "Your pick" ? "?" : champion.slice(0, 1)}</span><span><small>{role}</small><strong>{champion}</strong></span>{champion === "Your pick" ? <b>Choose</b> : null}</div>)}</div>;
}

function SafetyCard({ mark, title, body }: { mark: string; title: string; body: string }) {
  return <article className="safety-card"><span>{mark}</span><h3>{title}</h3><p>{body}</p></article>;
}

function SourceRow({ status, title, text, tone }: { status: string; title: string; text: string; tone: string }) {
  return <div className="source-row"><span className={`source-status ${tone}`}>{status}</span><div><h3>{title}</h3><p>{text}</p></div></div>;
}
