"use client";
import { useState } from "react";
import type { Plan } from "@/lib/types";

const OTHER_CITY: Record<string, string> = {
  "new york": "London",
  london: "New York",
  tokyo: "Ho Chi Minh City",
  "ho chi minh city": "Tokyo",
};

export function suggestions(plan: Plan): string[] {
  const out = ["Swap the bar for somewhere quieter", "Make it cheaper"];
  const who = plan.members[plan.members.length - 1];
  if (!plan.constraints?.dietary?.length) out.push(`${who} is vegetarian`);
  out.push("We want karaoke after dinner");
  const other = OTHER_CITY[plan.city.toLowerCase()] ?? "Ho Chi Minh City";
  out.push(`Move it to ${other}`);
  return out;
}

/** "Talk to the plan": a change request goes back to the agent, which re-queries Qloo for what must change. */
export function Refine({ plan, running, onSubmit }: { plan: Plan; running: boolean; onSubmit: (message: string) => void }) {
  const [text, setText] = useState("");
  const send = (m: string) => {
    const v = m.trim();
    if (!v || running) return;
    onSubmit(v);
    setText("");
  };
  return (
    <div className={`refine ${running ? "is-running" : ""}`}>
      <div className="refine-head">
        <span className="mono">Not quite right?</span>
        <p>Tell the agent what to change. It goes back to Qloo for the stops that need it and keeps the rest.</p>
      </div>
      <form
        className="refine-box"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={running ? "Re-planning…" : "e.g. somewhere quieter after dinner, Minh is vegan…"}
          aria-label="Ask for a change"
          disabled={running}
          maxLength={300}
        />
        <button className="btn btn-ink btn-sm" disabled={running || !text.trim()}>
          {running ? "Working…" : "Ask"} <span className="arr" aria-hidden>→</span>
        </button>
      </form>
      <div className="refine-chips">
        {suggestions(plan).map((s) => (
          <button key={s} type="button" className="pill" disabled={running} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
