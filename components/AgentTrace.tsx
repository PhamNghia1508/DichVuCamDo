"use client";
import type { AgentEvent } from "@/lib/types";

interface Row {
  id: string;
  label: string;
  summary?: string;
  state: "run" | "ok" | "bad";
  tool: string;
}

export function AgentTrace({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const rows: (Row | { id: string; thought: string })[] = [];
  const byId = new Map<string, Row>();
  let mode = "";
  events.forEach((e, i) => {
    if (e.type === "status") mode = e.message;
    if (e.type === "tool_start") {
      const r: Row = { id: e.id, label: e.label, state: "run", tool: e.tool };
      byId.set(e.id, r);
      rows.push(r);
    }
    if (e.type === "tool_end") {
      const r = byId.get(e.id);
      if (r) {
        r.state = e.ok ? "ok" : "bad";
        r.summary = e.summary;
      }
    }
    if (e.type === "thought") rows.push({ id: `t${i}`, thought: e.text });
  });
  return (
    <aside className="trace" aria-live="polite">
      <h3>
        <span className={`pulse ${running ? "" : "done"}`} /> Agent trace
      </h3>
      <div className="mode">{mode || "Starting…"}</div>
      <ol>
        {rows.map((r) =>
          "thought" in r ? (
            <li key={r.id}>
              <span className="thought">“{r.thought}”</span>
            </li>
          ) : (
            <li key={r.id}>
              <span className={`dot ${r.state}`}>{r.state === "ok" ? "✓" : r.state === "bad" ? "!" : ""}</span>
              <div>
                <div className="tool">{r.label}</div>
                {r.summary && <div className="sum">{r.summary}</div>}
              </div>
            </li>
          ),
        )}
      </ol>
    </aside>
  );
}
