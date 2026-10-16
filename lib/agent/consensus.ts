// Group consensus scoring on top of Qloo Insights.
//
// For a target type (place / movie / artist):
//   1. one /v2/insights call signalled by everyone's tastes together → the
//      candidate pool (top N for the blended group)
//   2. one /v2/insights call per member, signalled only by that member's
//      tastes and restricted with filter.results.entities to the pool → that
//      member's own affinity for every candidate
// Then every candidate gets:
//   memberAffinity[m]  — how strongly it fits member m alone (0 if absent)
//   groupAffinity      — how strongly it fits the blended group signal
//   consensus          — 0.45·group + 0.55·harmonicMean(member affinities)
//   fairness           — min(member) / max(member)
// The harmonic mean is the key design choice: one member scoring a pick at ~0
// drags it down hard, so the agent prefers "everyone likes it" over
// "two people love it, one hates it".

import type { QlooClient, InsightResult } from "../qloo";
import type { Candidate, ResolvedMember, TargetKind } from "../types";

export interface ConsensusOptions {
  city?: string;
  tagIds?: string[];
  excludeIds?: string[];
  take?: number;
}

const FLOOR = 0.04;

export function harmonicMean(values: number[]): number {
  if (!values.length) return 0;
  return values.length / values.reduce((s, v) => s + 1 / Math.max(FLOOR, v), 0);
}

export async function groupConsensus(
  qloo: QlooClient,
  members: ResolvedMember[],
  target: TargetKind,
  opts: ConsensusOptions = {},
): Promise<Candidate[]> {
  const take = opts.take ?? 16;
  const idsFor = (m: ResolvedMember) => m.tastes.map((t) => t.entity?.id).filter(Boolean) as string[];
  const active = members.filter((m) => idsFor(m).length > 0);
  if (!active.length) return [];

  // who owns which input entity (for "why" attributions)
  const owner = new Map<string, { member: string; label: string }[]>();
  for (const m of active)
    for (const t of m.tastes)
      if (t.entity) {
        const list = owner.get(t.entity.id) ?? [];
        list.push({ member: m.name, label: t.entity.name });
        owner.set(t.entity.id, list);
      }

  const base = { type: target, city: opts.city, tagIds: opts.tagIds, excludeIds: opts.excludeIds };
  const allIds = [...new Set(active.flatMap(idsFor))];
  const group = await qloo.insights({ ...base, entityIds: allIds, take });
  if (!group.length) return [];
  const poolIds = group.map((r) => r.entity.id);
  const perMember = await Promise.all(
    active.map((m) =>
      qloo
        .insights({ ...base, entityIds: idsFor(m), resultIds: poolIds, take: poolIds.length })
        .catch(() => [] as InsightResult[]),
    ),
  );

  const pool = new Map<string, Candidate>();
  const addDrivers = (c: Candidate, explain: Record<string, number>) => {
    for (const [id, score] of Object.entries(explain)) {
      if (score < 0.05) continue;
      for (const o of owner.get(id) ?? []) {
        const list = (c.drivers[o.member] ??= []);
        if (!list.includes(o.label)) list.push(o.label);
      }
    }
  };

  for (const r of group) {
    const c: Candidate = { entity: r.entity, groupAffinity: r.affinity, memberAffinity: {}, consensus: 0, fairness: 0, drivers: {} };
    for (const m of active) c.memberAffinity[m.name] = 0;
    addDrivers(c, r.explain);
    pool.set(r.entity.id, c);
  }
  active.forEach((m, i) => {
    for (const r of perMember[i]) {
      const c = pool.get(r.entity.id);
      if (!c) continue;
      c.memberAffinity[m.name] = Math.max(c.memberAffinity[m.name] ?? 0, r.affinity);
      addDrivers(c, r.explain);
    }
  });

  const out = [...pool.values()].map((c) => {
    const vals = active.map((m) => c.memberAffinity[m.name] ?? 0);
    const hm = harmonicMean(vals);
    const max = Math.max(...vals, 1e-6);
    c.consensus = Number((0.45 * c.groupAffinity + 0.55 * hm).toFixed(3));
    c.fairness = Number((Math.min(...vals) / max).toFixed(3));
    return c;
  });
  out.sort((a, b) => b.consensus - a.consensus);
  return out;
}
