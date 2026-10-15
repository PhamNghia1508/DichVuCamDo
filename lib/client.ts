"use client";
// Browser-side entry point. Normally streams from /api/plan; in the static
// GitHub Pages demo (no server) it runs the agent in the browser on mock data.
import type { AgentEvent, Plan, PlanRequest } from "./types";

export const IS_STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export async function planNight(req: PlanRequest, onEvent: (e: AgentEvent) => void): Promise<Plan> {
  if (IS_STATIC_DEMO) {
    const [{ runAgent, validateRequest }, { mockClient }] = await Promise.all([import("./agent/run"), import("./qloo")]);
    // Events fire instantly in-browser; replay them with a little pacing so the
    // agent trace reads like the live version.
    const events: AgentEvent[] = [];
    const plan = await runAgent(validateRequest(req), (e) => events.push(e), mockClient);
    for (const e of events) {
      onEvent(e);
      await new Promise((r) => setTimeout(r, e.type === "tool_end" ? 380 : 120));
    }
    return plan;
  }
  const res = await fetch(`${BASE_PATH}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let plan: Plan | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const e = JSON.parse(line) as AgentEvent;
      onEvent(e);
      if (e.type === "plan") plan = e.plan;
      if (e.type === "error") throw new Error(e.message);
    }
  }
  if (!plan) throw new Error("The agent stopped before finishing a plan.");
  return plan;
}

// --- share links: the plan travels in the URL fragment (never hits a server)
export function encodePlan(plan: Plan): string {
  const json = JSON.stringify(plan);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePlan(s: string): Plan | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Plan;
  } catch {
    return null;
  }
}
