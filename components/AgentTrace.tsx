"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/types";

interface Row {
  id: string;
  label: string;
  summary?: string;
  state: "run" | "ok" | "bad";
  tool: string;
  at: number;
}
type Line = Row | { id: string; thought: string; at: number };

const STAGES = [
  { key: "resolve", label: "Read tastes" },
  { key: "tags", label: "Venue types" },
  { key: "score", label: "Score group" },
  { key: "choose", label: "Choose & explain" },
  { key: "final", label: "Itinerary" },
] as const;

const TOOL_TAG: Record<string, string> = {
  resolve_group_tastes: "GET /search",
  find_tags: "GET /v2/tags",
  group_consensus: "GET /v2/insights",
  finalize_itinerary: "plan",
};

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function AgentTrace({ events, running }: { events: AgentEvent[]; running: boolean }) {
  // Client-side receipt times, so the log reads like a live run.
  const seen = useRef<number[]>([]);
  const t0 = useRef<number>(0);
  const [now, setNow] = useState(() => Date.now());
  if (events.length === 0) {
    seen.current = [];
    t0.current = 0;
  }
  if (!t0.current && events.length) t0.current = Date.now();
  while (seen.current.length < events.length) seen.current.push(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const rows: Line[] = [];
  const byId = new Map<string, Row>();
  let mode = "";
  let done = 0;
  let scoreTotal = 0;
  let scoreDone = 0;
  const reached = new Set<string>();
  events.forEach((e, i) => {
    const at = (seen.current[i] ?? Date.now()) - t0.current;
    if (e.type === "status") mode = e.message;
    if (e.type === "tool_start") {
      const r: Row = { id: e.id, label: e.label, state: "run", tool: e.tool, at };
      byId.set(e.id, r);
      rows.push(r);
      if (e.tool === "group_consensus") scoreTotal++;
      if (e.tool === "finalize_itinerary") reached.add("choose");
    }
    if (e.type === "tool_end") {
      const r = byId.get(e.id);
      if (r) {
        r.state = e.ok ? "ok" : "bad";
        r.summary = e.summary;
      }
      done++;
      if (e.tool === "resolve_group_tastes") reached.add("resolve");
      if (e.tool === "find_tags") reached.add("tags");
      if (e.tool === "group_consensus") scoreDone++;
      if (e.tool === "finalize_itinerary" && e.ok) reached.add("final");
    }
    if (e.type === "thought") {
      rows.push({ id: `t${i}`, thought: e.text, at });
      if (/shortlist/i.test(e.text)) reached.add("choose");
    }
    if (e.type === "plan") reached.add("final");
  });
  if (scoreTotal && scoreDone >= scoreTotal) reached.add("score");
  if (reached.has("final")) STAGES.forEach((s) => reached.add(s.key));
  if (reached.has("choose")) ["resolve", "tags", "score"].forEach((k) => reached.add(k));

  const activeIdx = STAGES.findIndex((s) => !reached.has(s.key));
  const scoreFrac = scoreTotal ? scoreDone / Math.max(scoreTotal, 4) : 0;
  const pct = reached.has("final")
    ? 100
    : Math.min(96, Math.round(((STAGES.filter((s) => reached.has(s.key)).length + (activeIdx === 2 ? scoreFrac : running ? 0.35 : 0)) / STAGES.length) * 100));
  const last = seen.current[seen.current.length - 1] ?? t0.current;
  const elapsed = t0.current ? (running ? Math.max(now, last) : last) - t0.current : 0;
  const finished = !running && reached.has("final");

  return (
    <aside className={`trace ${running ? "is-running" : ""} ${finished ? "is-done" : ""}`} aria-live="polite" aria-busy={running}>
      <div className="trace-head">
        <div className="trace-title">
          <span className={`pulse ${running ? "" : "done"}`} />
          <span>Agent log</span>
        </div>
        <span className="trace-clock mono">{fmt(Math.max(0, elapsed))}</span>
      </div>
      <div className="trace-mode mono">{mode || "Connecting to the planner…"}</div>

      <ol className="stages" aria-label="Progress">
        {STAGES.map((s, i) => {
          const state = reached.has(s.key) ? "ok" : i === activeIdx && running ? "run" : "todo";
          return (
            <li key={s.key} className={`stage ${state}`}>
              <span className="stage-dot" />
              <span className="stage-label">
                {s.label}
                {s.key === "score" && scoreTotal > 0 && !reached.has("score") ? ` ${scoreDone}/${Math.max(scoreTotal, 4)}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>

      <ol className="log" ref={listRef}>
        {rows.length === 0 && running && (
          <li className="log-row">
            <span className="log-t mono">0.0s</span>
            <span className="dot run" />
            <div className="tool">Waking up the agent…</div>
          </li>
        )}
        {rows.map((r) =>
          "thought" in r ? (
            <li key={r.id} className="log-row thought-row">
              <span className="log-t mono">{fmt(r.at)}</span>
              <span className="thought-mark" aria-hidden>
                ❝
              </span>
              <p className="thought">{r.thought}</p>
            </li>
          ) : (
            <li key={r.id} className={`log-row ${r.state}`}>
              <span className="log-t mono">{fmt(r.at)}</span>
              <span className={`dot ${r.state}`} aria-label={r.state === "ok" ? "done" : r.state === "bad" ? "failed" : "running"}>
                {r.state === "ok" ? "✓" : r.state === "bad" ? "!" : ""}
              </span>
              <div>
                <div className="tool">
                  {r.label} <span className="tool-tag mono">{TOOL_TAG[r.tool] ?? r.tool}</span>
                </div>
                {r.summary && <div className="sum">{r.summary}</div>}
              </div>
            </li>
          ),
        )}
      </ol>
      {finished && (
        <div className="trace-foot mono">
          Done in {fmt(elapsed)} · {done} tool calls
        </div>
      )}
    </aside>
  );
}
