// Group consensus scoring on top of Qloo Insights.
//
// For each slot:
//   1. one /v2/insights call signalled by EVERYONE's favourites (city + category
//      tags for places) → the candidate pool; category/constraint checks drop
//      anything that isn't a fit for the slot
//   2. one /v2/insights call PER MEMBER, signalled only by that member's
//      favourites and restricted with filter.results.entities to the pool → that
//      member's own affinity for every candidate. Places for dinner and the
//      after-plan share one call per member (the two pools are unioned).
// Qloo affinities are compressed (most land between 0.7 and 0.9), so each
// member's raw affinities are rescaled across the pool to a 0..1 "taste fit":
// 1 = the best thing in this pool for you, 0 = the worst. Then
//   consensus = 0.45 · groupFit + 0.55 · harmonicMean(memberFit)
//   fairness  = min(memberFit) / max(memberFit)
// The harmonic mean is the key choice: one member near 0 drags a pick down hard,
// so "everyone likes it" beats "two love it, one hates it".
//
// Explainability: the per-member call returns, for each candidate, how much each
// of that member's OWN favourites drove it. Those weights (not the group call's
// near-uniform split) become the member's drivers, so a reason only ever credits
// a favourite that Qloo actually weighted for that person.

import type { InsightResult, QlooClient } from "../qloo";
import type { Candidate, Constraints, Driver, Entity, ResolvedMember, Slot } from "../types";
import { SLOT_SPECS, constraintCheck, constraintParams, placeCheck, type SlotSpec } from "./slots";

export const GROUP = "__group";
export type Range = Record<string, [number, number]>;

const FLOOR = 0.04;
const round = (n: number) => Number(n.toFixed(3));

export function harmonicMean(values: number[]): number {
  if (!values.length) return 0;
  return values.length / values.reduce((s, v) => s + 1 / Math.max(FLOOR, v), 0);
}

export const idsFor = (m: ResolvedMember) => [...new Set(m.tastes.map((t) => t.entity?.id).filter(Boolean) as string[])];
export const activeMembers = (members: ResolvedMember[]) => members.filter((m) => idsFor(m).length > 0);

export interface PoolOptions {
  city?: string;
  constraints?: Constraints;
  excludeIds?: string[];
  /** extra/alternative category tags (e.g. karaoke) */
  tagIds?: string[];
  /** seed the pool from one member's favourites only (bridge search) */
  seedMember?: string;
}

export interface Pool {
  slot: Slot;
  spec: SlotSpec;
  results: InsightResult[];
  rejected: { name: string; reason: string }[];
}

/** Step 1: the candidate pool for a slot, validated for category and constraints. */
export async function fetchPool(qloo: QlooClient, members: ResolvedMember[], slot: Slot, opts: PoolOptions = {}): Promise<Pool> {
  const spec = SLOT_SPECS[slot];
  const active = activeMembers(members);
  const seed = opts.seedMember ? active.filter((m) => m.name === opts.seedMember) : active;
  const signal = [...new Set(seed.flatMap(idsFor))];
  const exclude = new Set([...(opts.excludeIds ?? []), ...active.flatMap(idsFor)]);
  const tagIds = opts.tagIds?.length ? opts.tagIds : spec.tagIds;
  const raw = await qloo.insights({
    type: spec.target,
    entityIds: signal,
    city: opts.city,
    tagIds,
    tagsOperator: tagIds && tagIds.length > 1 ? "union" : undefined,
    excludeIds: opts.excludeIds?.slice(0, 40),
    take: spec.take,
    ...constraintParams(slot, opts.constraints),
  });
  const rejected: Pool["rejected"] = [];
  const results = raw.filter((r) => {
    if (exclude.has(r.entity.id)) return false;
    const why = placeCheck(slot, r.entity) ?? constraintCheck(slot, r.entity, opts.constraints);
    if (why) rejected.push({ name: r.entity.name, reason: why });
    return !why;
  });
  // "quieter": prefer venues Qloo explicitly tags quiet/moderate when there are enough of them
  let kept = results;
  if (opts.constraints?.quiet && spec.target === "place") {
    const calm = results.filter((r) => /quiet|moderate/i.test(r.entity.facets?.noise ?? ""));
    if (calm.length >= 3) kept = calm;
  }
  return { slot, spec, results: kept.slice(0, slot === "playlist" ? 14 : 12), rejected };
}

/** Step 2: each member's own affinity + explainability for a set of candidate ids. */
export async function scoreMembers(qloo: QlooClient, members: ResolvedMember[], target: SlotSpec["target"], ids: string[]) {
  const active = activeMembers(members);
  const out = new Map<string, Map<string, InsightResult>>();
  if (!ids.length) return out;
  const lists = await Promise.all(
    active.map((m) =>
      qloo.insights({ type: target, entityIds: idsFor(m), resultIds: ids, take: ids.length }).catch(() => [] as InsightResult[]),
    ),
  );
  active.forEach((m, i) => out.set(m.name, new Map(lists[i].map((r) => [r.entity.id, r]))));
  return out;
}

function ownerIndex(members: ResolvedMember[]) {
  const owner = new Map<string, { member: string; entity: Entity }[]>();
  for (const m of activeMembers(members))
    for (const t of m.tastes)
      if (t.entity) {
        const list = owner.get(t.entity.id) ?? [];
        if (!list.some((o) => o.member === m.name)) list.push({ member: m.name, entity: t.entity });
        owner.set(t.entity.id, list);
      }
  return owner;
}

function rangeOf(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  return [Math.min(...values), Math.max(...values)];
}
/**
 * Taste fit on a 0..1 scale anchored to the pool Qloo surfaced for that member:
 * the pool's weakest candidate lands at ~0.36 and its strongest at ~0.93, so
 * anything Qloo scores below the whole pool (e.g. a plain-LLM pick) drops
 * towards 0 instead of every comparison saturating at 0 or 100.
 */
export function fit(raw: number | undefined, r: [number, number] | undefined): number {
  if (raw === undefined || raw <= 0) return 0;
  const [lo, hi] = r ?? [0, 1];
  const span = Math.max(hi - lo, 0.02);
  const lo2 = lo - 0.6 * span;
  const hi2 = hi + 0.08 * span;
  return Math.max(0, Math.min(1, (raw - lo2) / (hi2 - lo2)));
}

/** Member drivers from that member's own explainability (only their favourites, weighted). */
function driversFrom(explain: Record<string, number> | undefined, member: string, owner: ReturnType<typeof ownerIndex>): Driver[] {
  if (!explain) return [];
  const mine: { e: Entity; w: number }[] = [];
  for (const [id, w] of Object.entries(explain)) {
    const o = owner.get(id)?.find((x) => x.member === member);
    if (o && w > 0) mine.push({ e: o.entity, w });
  }
  const total = mine.reduce((s, x) => s + x.w, 0);
  if (!total) return [];
  mine.sort((a, b) => b.w - a.w);
  const top = mine[0].w;
  return mine
    .filter((x, i) => i === 0 || x.w >= top * 0.7)
    .slice(0, 2)
    .map((x) => ({ name: x.e.name, kind: x.e.kind, weight: round(x.w / total) }));
}

/** How much the blended group signal leaned on each member (1 = their fair share of inputs). */
function leanFrom(explain: Record<string, number>, members: ResolvedMember[], owner: ReturnType<typeof ownerIndex>) {
  const active = activeMembers(members);
  const totalInputs = active.reduce((s, m) => s + idsFor(m).length, 0);
  const totalW = Object.values(explain).reduce((s, w) => s + w, 0);
  const lean: Record<string, number> = {};
  if (!totalW || !totalInputs) return lean;
  for (const m of active) {
    let w = 0;
    for (const [id, s] of Object.entries(explain)) {
      const owners = owner.get(id) ?? [];
      if (owners.some((o) => o.member === m.name)) w += s / owners.length;
    }
    lean[m.name] = round(w / totalW / (idsFor(m).length / totalInputs));
  }
  return lean;
}

/**
 * Step 3: build scored candidates. `groupRaw` gives the blended-signal affinity per id.
 * When `ranges` is passed (bridge / audit), fits are placed on that existing scale.
 */
export function buildCandidates(
  members: ResolvedMember[],
  group: InsightResult[],
  perMember: Map<string, Map<string, InsightResult>>,
  ranges?: Range,
): { candidates: Candidate[]; range: Range } {
  const active = activeMembers(members);
  const owner = ownerIndex(members);
  const range: Range = ranges ? { ...ranges } : {};
  if (!ranges) {
    range[GROUP] = rangeOf(group.map((r) => r.affinity));
    for (const m of active) range[m.name] = rangeOf(group.map((r) => perMember.get(m.name)?.get(r.entity.id)?.affinity ?? NaN).filter((x) => !Number.isNaN(x)));
  }
  const candidates = group.map((r) => {
    const c: Candidate = {
      entity: r.entity,
      groupAffinity: r.affinity,
      memberRaw: {},
      memberAffinity: {},
      consensus: 0,
      fairness: 0,
      drivers: {},
      lean: leanFrom(r.explain, members, owner),
    };
    for (const m of active) {
      const mr = perMember.get(m.name)?.get(r.entity.id);
      c.memberRaw[m.name] = round(mr?.affinity ?? 0);
      c.memberAffinity[m.name] = round(fit(mr?.affinity, range[m.name]));
      const d = driversFrom(mr?.explain, m.name, owner);
      if (d.length) c.drivers[m.name] = d;
    }
    const vals = active.map((m) => c.memberAffinity[m.name] ?? 0);
    const hm = harmonicMean(vals);
    const max = Math.max(...vals, 1e-6);
    c.consensus = round(0.45 * fit(r.affinity, range[GROUP]) + 0.55 * hm);
    c.fairness = round(Math.min(...vals) / max);
    return c;
  });
  candidates.sort((a, b) => b.consensus - a.consensus);
  return { candidates, range };
}

/** Convenience: pool + member scoring + candidates for one slot (used by tools/tests). */
export async function groupConsensus(
  qloo: QlooClient,
  members: ResolvedMember[],
  slot: Slot,
  opts: PoolOptions = {},
): Promise<{ candidates: Candidate[]; range: Range; rejected: Pool["rejected"] }> {
  const pool = await fetchPool(qloo, members, slot, opts);
  if (!pool.results.length) return { candidates: [], range: {}, rejected: pool.rejected };
  const per = await scoreMembers(qloo, members, pool.spec.target, pool.results.map((r) => r.entity.id));
  return { ...buildCandidates(members, pool.results, per), rejected: pool.rejected };
}

/**
 * Bridge search: seed a pool from ONE member's own favourites (so it starts on
 * their side), then score it for everyone and place it on the slot's existing
 * fit scale. The best bridge raises the left-out member without sinking the rest.
 */
export async function bridgeSearch(
  qloo: QlooClient,
  members: ResolvedMember[],
  slot: Slot,
  member: string,
  ranges: Range | undefined,
  opts: PoolOptions = {},
): Promise<Candidate[]> {
  const pool = await fetchPool(qloo, members, slot, { ...opts, seedMember: member });
  if (!pool.results.length) return [];
  const ids = pool.results.map((r) => r.entity.id);
  const active = activeMembers(members);
  const [per, groupScored] = await Promise.all([
    scoreMembers(qloo, members, pool.spec.target, ids),
    qloo.insights({ type: pool.spec.target, entityIds: [...new Set(active.flatMap(idsFor))], resultIds: ids, take: ids.length }).catch(() => [] as InsightResult[]),
  ]);
  const groupById = new Map(groupScored.map((r) => [r.entity.id, r]));
  const group = pool.results.map((r) => ({ ...r, affinity: groupById.get(r.entity.id)?.affinity ?? r.affinity * 0.9, explain: groupById.get(r.entity.id)?.explain ?? r.explain }));
  const { candidates } = buildCandidates(members, group, per, ranges);
  candidates.forEach((c) => (c.bridgeFor = member));
  return candidates.sort((a, b) => b.consensus + 0.3 * b.fairness - (a.consensus + 0.3 * a.fairness));
}
