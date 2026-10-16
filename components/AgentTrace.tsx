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
type Line = Row | { id: string; thought: string; at: number; critique?: boolean } | { id: string; divider: string; at: number };

const STAGES = [
  { key: "resolve", label: "Read tastes" },
  { key: "map", label: "Taste map" },
  { key: "score", label: "Score picks" },
  { key: "decide", label: "Agent decides" },
  { key: "final", label: "Itinerary" },
] as const;

const TOOL_TAG: Record<string, string> = {
  resolve_group_tastes: "GET /search",
  taste_map: "/v2/insights · urn:tag + /compare",
  candidate_pool: "GET /v2/insights",
  member_affinity: "/v2/insights × friend",
  find_tags: "GET /v2/tags",
  find_bridge: "/v2/insights · bridge",
  finalize_itinerary: "critic + publish",
  write_copy: "writer model",
};

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function AgentTrace({ events, running, title = "Agent log" }: { events: AgentEvent[]; running: boolean; title?: string }) {
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
  let calls = 0;
  let runStart = 0;
  let runs = 0;
  let reached = new Set<string>();
  let scoreOpen = 0;
  events.forEach((e, i) => {
    const at = (seen.current[i] ?? Date.now()) - t0.current;
    if (e.type === "status") {
      mode = e.message;
      runs++;
      if (runs > 1) {
        rows.push({ id: `div${i}`, divider: "Refining the plan", at });
        reached = new Set(["resolve", "map", "score"]);
        runStart = at;
      }
    }
    if (e.type === "tool_start") {
      const r: Row = { id: e.id, label: e.label, state: "run", tool: e.tool, at };
      byId.set(e.id, r);
      rows.push(r);
      if (e.tool === "candidate_pool" || e.tool === "member_affinity") scoreOpen++;
      if (["find_bridge", "find_tags", "finalize_itinerary"].includes(e.tool) || (runs > 1 && e.tool === "candidate_pool")) reached.add("decide");
    }
    if (e.type === "tool_end") {
      const r = byId.get(e.id);
      if (r) {
        r.state = e.ok ? "ok" : "bad";
        r.summary = e.summary;
      }
      calls++;
      if (e.tool === "resolve_group_tastes") reached.add("resolve");
      if (e.tool === "taste_map") reached.add("map");
      if (e.tool === "candidate_pool" || e.tool === "member_affinity") scoreOpen--;
      if (e.tool === "finalize_itinerary" && e.ok) reached.add("final");
    }
    if (e.type === "thought") {
      rows.push({ id: `t${i}`, thought: e.text, at });
      if (/handing them|change request/i.test(e.text)) ["resolve", "map", "score", "decide"].forEach((k) => reached.add(k));
    }
    if (e.type === "critique") rows.push({ id: `c${i}`, thought: e.text, at, critique: true });
    if (e.type === "taste_map") reached.add("map");
    if (e.type === "plan") STAGES.forEach((s) => reached.add(s.key));
  });
  if (reached.has("decide")) ["resolve", "map", "score"].forEach((k) => reached.add(k));
  void scoreOpen;

  const activeIdx = STAGES.findIndex((s) => !reached.has(s.key));
  const pct = reached.has("final") ? 100 : Math.min(96, Math.round(((reached.size + (running ? 0.4 : 0)) / STAGES.length) * 100));
  const last = seen.current[seen.current.length - 1] ?? t0.current;
  const elapsed = t0.current ? (running ? Math.max(now, last) : last) - t0.current : 0;
  const finished = !running && reached.has("final");

  return (
    <aside className={`trace ${running ? "is-running" : ""} ${finished ? "is-done" : ""}`} aria-live="polite" aria-busy={running}>
      <div className="trace-head">
        <div className="trace-title">
          <span className={`pulse ${running ? "" : "done"}`} />
          <span>{title}</span>
        </div>
        <span className="trace-clock mono">{fmt(Math.max(0, elapsed - (running ? 0 : 0)))}</span>
      </div>
      <div className="trace-mode mono">{mode || "Connecting to the planner…"}</div>

      <ol className="stages" aria-label="Progress">
        {STAGES.map((s, i) => {
          const state = reached.has(s.key) ? "ok" : i === activeIdx && running ? "run" : "todo";
          return (
            <li key={s.key} className={`stage ${state}`}>
              <span className="stage-dot" />
              <span className="stage-label">{s.label}</span>
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
          "divider" in r ? (
            <li key={r.id} className="log-divider mono">
              <span>{r.divider}</span>
            </li>
          ) : "thought" in r ? (
            <li key={r.id} className={`log-row thought-row ${r.critique ? "critique-row" : ""}`}>
              <span className="log-t mono">{fmt(r.at)}</span>
              <span className="thought-mark" aria-hidden>
                {r.critique ? (
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    <path d="M3 14V2.5h8.5l-1.6 3 1.6 3H4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                ) : (
                  "❝"
                )}
              </span>
              <p className="thought">
                {r.critique && <span className="critic-tag mono">Critic</span>}
                {r.thought}
              </p>
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
          Done in {fmt(elapsed - runStart)} · {calls} agent steps{runs > 1 ? ` · ${runs - 1} refinement${runs > 2 ? "s" : ""}` : ""}
        </div>
      )}
    </aside>
  );
}
