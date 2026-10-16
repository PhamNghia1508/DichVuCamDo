// Shared agent state: resolved members, scored shortlists per slot (with short
// refs the LLM can quote), the fit scale per slot, and helpers to emit steps.

import type { QlooClient } from "../qloo";
import type {
  AgentEvent,
  Candidate,
  CircleMember,
  Constraints,
  Driver,
  ItineraryStop,
  Plan,
  PlanRequest,
  ResolvedMember,
  Slot,
  TasteMap,
} from "../types";
import type { Range } from "./consensus";

export type Emit = (e: AgentEvent) => void;

export const SLOTS: Slot[] = ["dinner", "activity", "playlist", "film"];
export const PREFIX: Record<Slot, string> = { dinner: "d", activity: "a", playlist: "p", film: "f" };
export const SLOT_TITLE: Record<Slot, string> = { dinner: "Dinner", activity: "Then", playlist: "Soundtrack for the ride", film: "Next movie night" };
export const SLOT_TIME: Partial<Record<Slot, string>> = { dinner: "7:00 PM", activity: "9:00 PM" };

export interface Ctx {
  qloo: QlooClient;
  request: PlanRequest;
  city: string;
  emit: Emit;
  members: ResolvedMember[];
  constraints: Constraints;
  /** current shortlist per slot (best first) */
  slots: Partial<Record<Slot, Candidate[]>>;
  ranges: Partial<Record<Slot, Range>>;
  refs: Map<string, { slot: Slot; c: Candidate }>;
  refCount: Record<Slot, number>;
  tasteMap?: TasteMap;
  critiques: string[];
  bridgeTried: Set<string>;
  planner: "llm" | "deterministic";
  model?: string;
  llmTurns: number;
  startedAt: number;
  /** plan being refined */
  base?: Plan;
  plan: Plan | null;
}

export function newCtx(qloo: QlooClient, request: PlanRequest, emit: Emit, base?: Plan): Ctx {
  return {
    qloo,
    request,
    city: request.city,
    emit,
    members: [],
    constraints: { ...(base?.constraints ?? {}), ...(request.constraints ?? {}) },
    slots: {},
    ranges: { ...(base?.ranges ?? {}) } as Ctx["ranges"],
    refs: new Map(),
    refCount: { dinner: 0, activity: 0, playlist: 0, film: 0 },
    critiques: [],
    bridgeTried: new Set(),
    planner: "deterministic",
    llmTurns: 0,
    startedAt: Date.now(),
    base,
    plan: null,
  };
}

let seq = 0;
/** Run one visible agent step: emits tool_start / tool_end around fn. */
export async function step<T>(
  ctx: Ctx,
  tool: string,
  label: string,
  fn: () => Promise<{ value: T; summary: string }>,
  args?: unknown,
): Promise<T> {
  const id = `s${seq++}`;
  ctx.emit({ type: "tool_start", id, tool, label, args });
  try {
    const { value, summary } = await fn();
    ctx.emit({ type: "tool_end", id, tool, summary, ok: true });
    return value;
  } catch (err) {
    ctx.emit({ type: "tool_end", id, tool, summary: (err as Error).message.slice(0, 200), ok: false });
    throw err;
  }
}

/** Store a shortlist for a slot and give every candidate a short ref (d1, a4, p2…). */
export function register(ctx: Ctx, slot: Slot, list: Candidate[], mode: "replace" | "merge" = "replace") {
  for (const c of list) {
    const existing = [...ctx.refs.entries()].find(([, v]) => v.slot === slot && v.c.entity.id === c.entity.id);
    if (existing) {
      existing[1].c = c;
      continue;
    }
    const ref = `${PREFIX[slot]}${++ctx.refCount[slot]}`;
    ctx.refs.set(ref, { slot, c });
  }
  if (mode === "replace") ctx.slots[slot] = list;
  else {
    const seen = new Set<string>();
    ctx.slots[slot] = [...list, ...(ctx.slots[slot] ?? [])].filter((c) => !seen.has(c.entity.id) && !!seen.add(c.entity.id));
  }
}

export function refOf(ctx: Ctx, slot: Slot, id: string) {
  for (const [ref, v] of ctx.refs) if (v.slot === slot && v.c.entity.id === id) return ref;
  return undefined;
}

export const pct = (n: number | undefined) => Math.round((n ?? 0) * 100);
export const names = (ctx: Ctx) => ctx.request.members.map((m) => m.name);

/** Compact view of a candidate for the LLM: refs instead of UUIDs, percentages, per-member drivers. */
export function brief(ctx: Ctx, slot: Slot, c: Candidate) {
  const e = c.entity;
  const about = [e.subtitle, e.facets?.categories?.slice(1, 3).join("/"), e.neighborhood, e.priceLevel ? "$".repeat(e.priceLevel) : undefined, e.facets?.noise ? `${e.facets.noise.toLowerCase()} room` : undefined]
    .filter(Boolean)
    .join(" · ");
  return {
    ref: refOf(ctx, slot, e.id),
    name: e.name,
    ...(about ? { about } : {}),
    consensus: pct(c.consensus),
    fairness: pct(c.fairness),
    fit: Object.fromEntries(Object.entries(c.memberAffinity).map(([k, v]) => [k, pct(v)])),
    because: Object.fromEntries(Object.entries(c.drivers).map(([k, v]) => [k, v.map((d) => d.name)])),
    ...(c.bridgeFor ? { bridge_for: c.bridgeFor } : {}),
  };
}

export function shortlist(ctx: Ctx, slot: Slot, n = slot === "playlist" ? 8 : 5) {
  return (ctx.slots[slot] ?? []).slice(0, n).map((c) => brief(ctx, slot, c));
}

export function circleOf(members: ResolvedMember[]): CircleMember[] {
  return members.map((m) => ({
    name: m.name,
    likes: m.tastes.filter((t) => t.entity).map((t) => ({ id: t.entity!.id, name: t.entity!.name, kind: t.entity!.kind })),
  }));
}

export function membersFromCircle(circle: CircleMember[]): ResolvedMember[] {
  return circle.map((m) => ({
    name: m.name,
    tastes: m.likes.map((l) => ({
      input: l.name,
      kind: l.kind === "place" ? "place" : l.kind === "artist" ? "artist" : l.kind === "movie" || l.kind === "tv_show" ? "movie" : "book",
      entity: { id: l.id, name: l.name, kind: l.kind },
    })),
  }));
}

/** Rebuild a candidate from a stop of an existing plan (so "keep" works during refinement). */
export function candidateFromStop(stop: ItineraryStop): Candidate | null {
  if (!stop.entity) return null;
  return {
    entity: stop.entity,
    groupAffinity: 0,
    memberRaw: stop.memberRaw ?? {},
    memberAffinity: stop.memberScores ?? {},
    consensus: stop.consensus ?? 0,
    fairness: stop.fairness ?? 0,
    drivers: stop.drivers ?? {},
    lean: {},
    bridgeFor: stop.bridgeFor,
  };
}

export function listify(xs: string[]) {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function fitWord(f: number) {
  return f >= 0.75 ? "top" : f >= 0.45 ? "solid" : f >= 0.25 ? "fair" : "stretch";
}

/** Templated reason grounded in that member's drivers and fit (deterministic planner + fallback fill). */
export function defaultWhy(member: string, c: Candidate): string {
  const d: Driver[] = c.drivers[member] ?? [];
  const f = c.memberAffinity[member] ?? 0;
  if (c.bridgeFor === member) return `Picked as your bridge: Qloo started from ${d.length ? `your ${listify(d.map((x) => x.name))}` : "your favourites"} and found the spot the rest of the circle can meet you at.`;
  if (d.length && f >= 0.45) return `Qloo ties this to your ${listify(d.map((x) => x.name))} — a ${fitWord(f)} fit for you (${pct(f)}%).`;
  if (d.length) return `A stretch for you (${pct(f)}% fit), but your ${d[0].name} is what Qloo says pulls it your way.`;
  return `Not your usual — it's here because it scores well with everyone else, and nothing in it clashes with your taste.`;
}

/** Turn a chosen candidate into an itinerary stop. */
export function stopFrom(slot: Slot, c: Candidate, blurb: string, why: Record<string, string>, members: string[]): ItineraryStop {
  return {
    slot,
    title: SLOT_TITLE[slot],
    time: SLOT_TIME[slot],
    entity: slim(c.entity),
    blurb,
    // fragments ("The cinematic feel of Drive.") fall back to the grounded template
    whyByMember: Object.fromEntries(members.map((m) => [m, (why[m]?.trim().split(/\s+/).length ?? 0) >= 7 ? why[m].trim() : defaultWhy(m, c)])),
    consensus: c.consensus,
    fairness: c.fairness,
    memberScores: c.memberAffinity,
    memberRaw: c.memberRaw,
    drivers: c.drivers,
    ...(c.bridgeFor ? { bridgeFor: c.bridgeFor } : {}),
  };
}

/** Keep share links small: drop facets we don't render. */
export function slim<T extends { facets?: unknown; tags?: string[] }>(e: T): T {
  const { facets, ...rest } = e as T & { facets?: { categories?: string[]; dietary?: string[]; noise?: string } };
  const f = facets as { categories?: string[]; dietary?: string[]; noise?: string } | undefined;
  return { ...(rest as T), ...(f ? { facets: { categories: f.categories?.slice(0, 2), dietary: f.dietary?.slice(0, 2), noise: f.noise } } : {}), tags: e.tags?.slice(0, 3) };
}
