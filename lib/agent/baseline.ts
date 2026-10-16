// "LLM alone" baseline — the control experiment judges asked for.
//
// 1. Ask the same LLM, with NO Qloo data, to plan the same night for the same
//    group (it only sees the names of everyone's favourites, exactly like a
//    friend in the group chat would).
// 2. Audit its picks with Qloo: does the place exist in Qloo's graph in that
//    city (GET /search), and how does it score for each member (GET /v2/insights
//    with filter.results.entities, one call per member per type)? Fits are put
//    on the same per-member scale as the Qloo-grounded plan, so the numbers are
//    directly comparable.

import { getQloo, type InsightResult, type QlooClient } from "../qloo";
import type { BaselinePick, BaselineResult, Entity, Plan, ResolvedMember, Slot } from "../types";
import { GROUP, fit, harmonicMean, idsFor, activeMembers } from "./consensus";
import { membersFromCircle } from "./context";
import { chat, llmConfig } from "./llm";
import { placeCheck } from "./slots";

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !["the", "and", "bar", "restaurant", "cafe", "club"].includes(t));

const CITY_ALIASES: Record<string, string[]> = {
  "new york": ["new york", " ny ", "brooklyn", "manhattan", "queens"],
  "ho chi minh city": ["ho chi minh", "hcm", "saigon", "sai gon"],
  tokyo: ["tokyo", "東京"],
  london: ["london"],
};
function inCity(e: Entity, city: string) {
  if (!e.address) return true;
  const addr = ` ${e.address.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[,]/g, " ")} `;
  const key = city.trim().toLowerCase();
  const toks = CITY_ALIASES[key] ?? key.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter((t) => t.length > 2 && t !== "city");
  return toks.some((t) => addr.includes(t));
}
function withElsewhere(p: BaselinePick | null, e: Entity | null): BaselinePick | null {
  if (p && e && (e as Entity & { elsewhere?: boolean }).elsewhere) return { ...p, unverified: true, elsewhere: e.address?.split(/,| {2}/).slice(-2).join(",").trim() || "another city" };
  return p;
}

function sameName(a: string, b: string) {
  const A = new Set(tokens(a));
  const B = tokens(b);
  if (!A.size || !B.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return B.filter((t) => A.has(t)).length / Math.max(A.size, B.length) >= 0.5;
}

interface LlmDraft {
  dinner?: { name?: string; why?: string };
  activity?: { name?: string; why?: string };
  film?: { name?: string; why?: string };
  playlist?: string[];
}

async function askPlainLlm(plan: Plan, members: ResolvedMember[]): Promise<{ draft: LlmDraft; model: string }> {
  const cfg = llmConfig();
  if (!cfg) {
    // No LLM configured: a fixed "generic recommender" stand-in, clearly labelled in the UI.
    return {
      model: "generic picks (no LLM key)",
      draft: { dinner: { name: "Nonna Neon", why: "Everyone likes Italian." }, activity: { name: "Echo Karaoke Lounge", why: "Karaoke is fun for groups." }, film: { name: "Mamma Mia!", why: "A crowd-pleaser." }, playlist: ["Coldplay", "Ed Sheeran", "Dua Lipa"] },
    };
  }
  const who = members.map((m) => `${m.name} likes ${m.tastes.map((t) => t.entity?.name ?? t.input).join(", ")}`).join("; ");
  const msg = await chat(
    cfg,
    {
      messages: [
        { role: "system", content: "You are a helpful assistant planning a night out for a group of friends. Recommend real, specific places that exist." },
        {
          role: "user",
          content: `City: ${plan.city}.${plan.vibe ? ` Vibe: ${plan.vibe}.` : ""} ${who}. Suggest one dinner restaurant, one after-dinner bar or venue, one film for their next movie night and 4 artists for a shared playlist. Reply as JSON: {"dinner":{"name","why"},"activity":{"name","why"},"film":{"name","why"},"playlist":["artist",...]}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.7,
    },
    Date.now() + 20_000,
  );
  let draft: LlmDraft = {};
  try {
    draft = JSON.parse(String(msg.content ?? "{}"));
  } catch {
    /* empty draft → nothing to audit */
  }
  return { draft, model: cfg.model };
}

export async function runBaseline(plan: Plan, qloo: QlooClient = getQloo()): Promise<BaselineResult> {
  const t0 = Date.now();
  if (!plan?.circle?.length) throw new Error("plan.circle missing");
  const members = membersFromCircle(plan.circle);
  const active = activeMembers(members);
  const { draft, model } = await askPlainLlm(plan, members);

  const place = async (asked: string | undefined, slot: Slot) => {
    if (!asked) return null;
    const list = await qloo.searchPlaces(asked, plan.city).catch(() => [] as Entity[]);
    const named = list.filter((e) => sameName(asked, e.name) && !placeCheck(slot, e));
    return named.find((e) => inCity(e, plan.city)) ?? (named[0] ? { ...named[0], elsewhere: true } : null);
  };
  const [dinner, activity, film, ...artists] = await Promise.all([
    place(draft.dinner?.name, "dinner"),
    place(draft.activity?.name, "activity"),
    draft.film?.name ? qloo.search(draft.film.name, "movie").catch(() => null) : null,
    ...(draft.playlist ?? []).slice(0, 3).map((a) => qloo.search(String(a), "artist").catch(() => null)),
  ]);

  const verified = (asked: string | undefined, e: Entity | null) => (e && asked && sameName(asked, e.name) ? e : null);
  const elsewhere = (e: Entity | null) => !!(e as (Entity & { elsewhere?: boolean }) | null)?.elsewhere;
  const d = dinner && !elsewhere(dinner) ? dinner : null;
  const a = activity && !elsewhere(activity) ? activity : null;
  const f = verified(draft.film?.name, film);
  const art = artists.map((x, i) => verified(draft.playlist?.[i], x)).filter(Boolean) as Entity[];

  // one call per member per type (+ one group call per type) restricted to the LLM's picks
  const byType: { type: "place" | "movie" | "artist"; ids: string[] }[] = [
    { type: "place" as const, ids: [d?.id, a?.id].filter(Boolean) as string[] },
    { type: "movie" as const, ids: f ? [f.id] : [] },
    { type: "artist" as const, ids: art.map((x) => x.id) },
  ].filter((x) => x.ids.length);
  const scores = new Map<string, Map<string, number>>(); // entity id → member → raw
  await Promise.all(
    byType.flatMap(({ type, ids }) => [
      ...active.map((m) =>
        qloo
          .insights({ type, entityIds: idsFor(m), resultIds: ids, take: ids.length })
          .then((list) => list.forEach((r) => (scores.get(r.entity.id) ?? scores.set(r.entity.id, new Map()).get(r.entity.id)!).set(m.name, r.affinity)))
          .catch(() => undefined),
      ),
      qloo
        .insights({ type, entityIds: [...new Set(active.flatMap(idsFor))], resultIds: ids, take: ids.length })
        .then((list: InsightResult[]) => list.forEach((r) => (scores.get(r.entity.id) ?? scores.set(r.entity.id, new Map()).get(r.entity.id)!).set(GROUP, r.affinity)))
        .catch(() => undefined),
    ]),
  );

  const scorePick = (slot: Slot, name: string | undefined, note: string | undefined, e: Entity | null, rangeSlot: Slot = slot): BaselinePick | null => {
    if (!name) return null;
    if (!e) return { slot, name, note, unverified: true };
    const owner = members.find((m) => m.tastes.some((t) => t.entity?.id === e.id));
    if (owner) return { slot, name, note: `${note ?? ""}`.trim(), found: { id: e.id, name: e.name }, echo: owner.name };
    const raw = scores.get(e.id);
    const ranges = plan.ranges?.[rangeSlot] ?? {};
    const memberScores = Object.fromEntries(active.map((m) => [m.name, Number(fit(raw?.get(m.name), ranges[m.name]).toFixed(3))]));
    const vals = Object.values(memberScores);
    const consensus = 0.45 * fit(raw?.get(GROUP), ranges[GROUP]) + 0.55 * harmonicMean(vals);
    return {
      slot,
      name,
      note,
      found: { id: e.id, name: e.name, address: e.address, categories: e.facets?.categories?.slice(0, 2) },
      memberScores,
      consensus: Number(consensus.toFixed(3)),
      fairness: Number((Math.min(...vals) / Math.max(...vals, 1e-6)).toFixed(3)),
    };
  };

  const picks = [
    withElsewhere(scorePick("dinner", draft.dinner?.name, draft.dinner?.why, d), dinner),
    withElsewhere(scorePick("activity", draft.activity?.name, draft.activity?.why, a), activity),
    scorePick("film", draft.film?.name, draft.film?.why, f),
  ].filter(Boolean) as BaselinePick[];
  // playlist: average over the artists that resolved
  if (draft.playlist?.length) {
    const each = art.map((x) => scorePick("playlist", x.name, undefined, x)!);
    const echoes = each.filter((p) => p.echo).map((p) => p.found!.name);
    const scored = each.filter((p) => p.memberScores);
    const avg = (k: (p: BaselinePick) => number) => scored.reduce((s, p) => s + k(p), 0) / Math.max(1, scored.length);
    picks.push({
      slot: "playlist",
      name: draft.playlist.slice(0, 4).join(", "),
      ...(each.length ? { found: { id: each[0].found!.id, name: art.map((x) => x.name).join(", ") } } : { unverified: true }),
      ...(echoes.length ? { echoes } : {}),
      ...(scored.length
        ? {
            memberScores: Object.fromEntries(active.map((m) => [m.name, Number(avg((p) => p.memberScores?.[m.name] ?? 0).toFixed(3))])),
            consensus: Number(avg((p) => p.consensus ?? 0).toFixed(3)),
            fairness: Number(avg((p) => p.fairness ?? 0).toFixed(3)),
          }
        : {}),
    });
  }
  return { model, picks, ms: Date.now() - t0 };
}
