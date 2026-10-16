"use client";
// Browser-side entry points. Normally stream from the API routes; in the static
// GitHub Pages demo (no server) the agent runs in the browser on mock data.
import type { AgentEvent, BaselineResult, MemberInput, Plan, PlanRequest } from "./types";

export const IS_STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function replay(events: AgentEvent[], onEvent: (e: AgentEvent) => void) {
  // Events fire instantly in-browser; replay with a little pacing so the log reads like the live version.
  for (const e of events) {
    onEvent(e);
    await new Promise((r) => setTimeout(r, e.type === "tool_end" ? 320 : 110));
  }
}

async function stream(path: string, body: unknown, onEvent: (e: AgentEvent) => void): Promise<Plan> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  if (!plan) throw new Error("The agent stopped before finishing — the connection may have dropped. Give it another go.");
  return plan;
}

export async function planNight(req: PlanRequest, onEvent: (e: AgentEvent) => void): Promise<Plan> {
  if (IS_STATIC_DEMO) {
    const [{ runAgent, validateRequest }, { makeMockClient }] = await Promise.all([import("./agent/run"), import("./qloo")]);
    const events: AgentEvent[] = [];
    const plan = await runAgent(validateRequest(req), (e) => events.push(e), makeMockClient());
    await replay(events, onEvent);
    return plan;
  }
  return stream("/api/plan", req, onEvent);
}

export async function refinePlan(plan: Plan, message: string, onEvent: (e: AgentEvent) => void): Promise<Plan> {
  if (IS_STATIC_DEMO) {
    const [{ refineAgent }, { makeMockClient }] = await Promise.all([import("./agent/run"), import("./qloo")]);
    const events: AgentEvent[] = [];
    const next = await refineAgent(plan, message, (e) => events.push(e), makeMockClient());
    await replay(events, onEvent);
    return next;
  }
  return stream("/api/refine", { plan, message }, onEvent);
}

export async function fetchBaseline(plan: Plan): Promise<BaselineResult> {
  if (IS_STATIC_DEMO) {
    const [{ runBaseline }, { makeMockClient }] = await Promise.all([import("./agent/baseline"), import("./qloo")]);
    return runBaseline(plan, makeMockClient());
  }
  const res = await fetch(`${BASE_PATH}/api/baseline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j as BaselineResult;
}

// --- links: plans and invites travel in the URL fragment (never hit a server).
// JSON → deflate-raw (when the browser supports it) → base64url. Prefix "z" = compressed.
const b64u = (bytes: Uint8Array) => {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipeThrough(bytes: Uint8Array, t: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(t));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeData(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== "undefined") {
    try {
      return "z" + b64u(await pipeThrough(bytes, new CompressionStream("deflate-raw")));
    } catch {
      /* fall through */
    }
  }
  return b64u(bytes);
}

export async function decodeData<T>(s: string): Promise<T | null> {
  try {
    const raw = s.startsWith("z") ? await pipeThrough(unb64u(s.slice(1)), new DecompressionStream("deflate-raw")) : unb64u(s);
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}

export const encodePlan = (plan: Plan) => encodeData(plan);
export const decodePlan = (s: string) => decodeData<Plan>(s);

/** An invite carries the circle so far: city, vibe, who's in and their favourites. */
export interface Invite {
  city: string;
  vibe?: string;
  host?: string;
  members: MemberInput[];
}
export const inviteLink = async (inv: Invite) => `${window.location.origin}${BASE_PATH}/${IS_STATIC_DEMO ? "" : ""}#join=${await encodeData(inv)}`;
export const readInvite = (hash: string) => (hash.startsWith("#join=") ? decodeData<Invite>(hash.slice(6)) : Promise.resolve(null));
