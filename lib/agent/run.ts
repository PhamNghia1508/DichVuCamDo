// The TasteCircle agent.
//
// Phase A — always, no LLM tokens spent (fast and parallel through the Qloo queue):
//   resolve every favourite (GET /search, cross-domain) → taste map (urn:tag
//   insights per member + /v2/insights/compare) and, concurrently, a scored
//   shortlist per slot (group pool + per-member affinity + explainability).
// Phase B — with an LLM key: a real tool-calling loop. The model reads the
//   shortlists and the taste map, may re-query Qloo (search_slot with
//   constraints, find_bridge for a left-out friend, set_city when refining),
//   and publishes with finalize_itinerary. A server-side critic rejects a
//   draft that leaves someone out without trying a bridge first.
// Without an LLM (or when it fails / runs out of time) the deterministic
//   planner finishes from the scores already computed — same critic, same
//   bridge search, templated copy. No Qloo call is repeated.

import { getQloo, type QlooClient } from "../qloo";
import type { Candidate, Constraints, MemberInput, Plan, PlanRequest, Slot, TasteKind } from "../types";
import { activeMembers, bridgeSearch, buildCandidates, fetchPool, scoreMembers, type Pool, type PoolOptions } from "./consensus";
import {
  SLOTS,
  candidateFromStop,
  circleOf,
  defaultWhy,
  listify,
  membersFromCircle,
  names,
  newCtx,
  pct,
  register,
  shortlist,
  slim,
  step,
  stopFrom,
  type Ctx,
  type Emit,
} from "./context";
import { chat, llmConfig, parseArgs, type ChatMessage, type LlmConfig, type ToolDef } from "./llm";
import { ACTIVITY_WORDS, SLOT_SPECS } from "./slots";
import { buildTasteMap, tasteMapBrief } from "./tasteMap";
import { hasBanned, polishCopy } from "./writer";

const env = (k: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[k] : undefined;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export function validateRequest(body: unknown): PlanRequest {
  const b = body as PlanRequest;
  if (!b || !Array.isArray(b.members)) throw new Error("members[] is required");
  const members: MemberInput[] = b.members
    .slice(0, 8)
    .map((m, i) => ({
      name: String(m?.name || `Friend ${i + 1}`).trim().slice(0, 40) || `Friend ${i + 1}`,
      tastes: {
        artist: clean(m?.tastes?.artist),
        movie: clean(m?.tastes?.movie),
        place: clean(m?.tastes?.place),
        book: clean(m?.tastes?.book),
      },
    }))
    .filter((m) => Object.values(m.tastes).some((l) => l.length));
  if (members.length < 2) throw new Error("Add at least two people with at least one favourite each.");
  const seen = new Set<string>();
  for (const m of members) {
    let n = m.name;
    for (let k = 2; seen.has(n); k++) n = `${m.name} ${k}`;
    m.name = n;
    seen.add(n);
  }
  const city = String(b.city || "").trim().slice(0, 80);
  if (!city) throw new Error("Which city are you going out in?");
  return { members, city, vibe: b.vibe ? String(b.vibe).slice(0, 120) : undefined, constraints: cleanConstraints(b.constraints) };
}

function clean(list: unknown): string[] {
  return Array.isArray(list) ? list.map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 5) : [];
}
function cleanConstraints(c: unknown): Constraints | undefined {
  if (!c || typeof c !== "object") return undefined;
  const x = c as Constraints;
  return {
    ...(x.priceMax ? { priceMax: Math.max(1, Math.min(4, Number(x.priceMax) || 4)) } : {}),
    ...(x.quiet ? { quiet: true } : {}),
    ...(Array.isArray(x.dietary) ? { dietary: x.dietary.map(String).slice(0, 3) } : {}),
    ...(Array.isArray(x.dietaryFor) ? { dietaryFor: x.dietaryFor.map(String).slice(0, 8) } : {}),
    ...(x.activity ? { activity: String(x.activity).slice(0, 40) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Phase A: resolve, taste map, score
// ---------------------------------------------------------------------------

const KIND_NOUN: Record<string, [string, string]> = {
  artist: ["artist", "artists"],
  movie: ["film", "films"],
  tv_show: ["show", "shows"],
  book: ["book", "books"],
  podcast: ["podcast", "podcasts"],
  place: ["place", "places"],
};

async function resolveTastes(ctx: Ctx) {
  await step(ctx, "resolve_group_tastes", "Matching everyone’s favourites in Qloo’s taste graph", async () => {
    const out = await Promise.all(
      ctx.request.members.map(async (m) => {
        const jobs: Promise<{ input: string; kind: TasteKind; entity: Awaited<ReturnType<QlooClient["search"]>> }>[] = [];
        for (const kind of Object.keys(m.tastes) as TasteKind[])
          for (const input of m.tastes[kind] ?? [])
            jobs.push(
              ctx.qloo
                .search(input, kind, ctx.city)
                .then((entity) => ({ input, kind, entity }))
                .catch(() => ({ input, kind, entity: null })),
            );
        return { name: m.name, tastes: await Promise.all(jobs) };
      }),
    );
    ctx.members = out;
    const all = out.flatMap((m) => m.tastes);
    const found = all.filter((t) => t.entity);
    const byKind = new Map<string, number>();
    for (const t of found) byKind.set(t.entity!.kind, (byKind.get(t.entity!.kind) ?? 0) + 1);
    const kinds = [...byKind.entries()].map(([k, n]) => `${n} ${KIND_NOUN[k][n === 1 ? 0 : 1]}`).join(", ");
    const missed = all.filter((t) => !t.entity).map((t) => `“${t.input}”`);
    if (activeMembers(out).length < 2) throw new Error("Qloo couldn’t match enough favourites — try more well-known artists, films or places.");
    return { value: out, summary: `Matched ${found.length}/${all.length}: ${kinds}${missed.length ? ` · no match for ${missed.slice(0, 2).join(", ")}` : ""}` };
  });
}

async function tasteMapStep(ctx: Ctx) {
  try {
    const map = await step(ctx, "taste_map", "Reading each friend’s taste fingerprint", async () => {
      const m = await buildTasteMap(ctx.qloo, ctx.members);
      const far = m.bridge ? ` · ${m.bridge.a} ↔ ${m.bridge.b} meet on ${listify(m.bridge.tags.slice(0, 2))}` : "";
      return { value: m, summary: `${m.members.length} fingerprints · ${m.shared.length} shared tags${far}` };
    });
    ctx.tasteMap = map;
    ctx.emit({ type: "taste_map", map });
  } catch {
    /* the taste map is a bonus; planning continues without it */
  }
}

const POOL_LABEL: Record<Slot, (city: string) => string> = {
  dinner: (c) => `Finding dinner spots in ${c} the whole circle’s taste points to`,
  activity: (c) => `Finding the after-dinner plan in ${c}: bars, venues, shows`,
  playlist: () => "Finding artists that sit between everyone’s music",
  film: () => "Finding a film for the next movie night",
};

/** Score the given slots: pools in parallel, then one per-member call per entity type. */
async function scoreSlots(ctx: Ctx, slots: Slot[], extra: Partial<Record<Slot, PoolOptions>> = {}, quiet = false) {
  const used = usedIds(ctx);
  const pools = await Promise.all(
    slots.map((slot) =>
      step(ctx, "candidate_pool", POOL_LABEL[slot](ctx.city), async () => {
        const opts: PoolOptions = { city: ctx.city, constraints: ctx.constraints, excludeIds: used, ...(extra[slot] ?? {}) };
        let p = await fetchPool(ctx.qloo, ctx.members, slot, opts);
        if (!p.results.length && SLOT_SPECS[slot].target === "place" && (opts.tagIds || ctx.constraints.dietary)) {
          // too narrow → widen once (drop the extra type filter), keep the hard checks
          p = await fetchPool(ctx.qloo, ctx.members, slot, { ...opts, tagIds: undefined });
        }
        const drop = p.rejected.slice(0, 2).map((r) => `${r.name} ${r.reason}`);
        return {
          value: p,
          summary: p.results.length
            ? `${p.results.length} candidates${p.rejected.length ? ` · dropped ${p.rejected.length} (${drop.join("; ")})` : ""}`
            : "No candidates found",
        };
      }).catch(() => null),
    ),
  );
  const valid = pools.filter((p): p is Pool => !!p && p.results.length > 0);
  const byTarget = new Map<string, Pool[]>();
  for (const p of valid) byTarget.set(p.spec.target, [...(byTarget.get(p.spec.target) ?? []), p]);
  const nounFor: Record<string, string> = { place: "places", artist: "artists", movie: "films" };
  await Promise.all(
    [...byTarget.entries()].map(async ([target, ps]) => {
      const ids = [...new Set(ps.flatMap((p) => p.results.map((r) => r.entity.id)))];
      const per = await step(
        ctx,
        "member_affinity",
        `Scoring ${ids.length} ${nounFor[target]} against each friend’s own taste`,
        async () => {
          const v = await scoreMembers(ctx.qloo, ctx.members, ps[0].spec.target, ids);
          return { value: v, summary: `${v.size} friends × ${ids.length} ${nounFor[target]} · explainability on` };
        },
      ).catch(() => new Map());
      for (const p of ps) {
        const { candidates, range } = buildCandidates(ctx.members, p.results, per);
        ctx.ranges[p.slot] = range;
        register(ctx, p.slot, candidates);
        if (!quiet) noteFrontRunner(ctx, p.slot);
      }
    }),
  );
}

function noteFrontRunner(ctx: Ctx, slot: Slot) {
  const top = ctx.slots[slot]?.[0];
  if (!top || slot === "playlist") return;
  const entries = Object.entries(top.memberAffinity).sort((a, b) => a[1] - b[1]);
  const [low, lowFit] = entries[0] ?? ["", 0];
  ctx.emit({
    type: "thought",
    text: `${SLOT_SPECS[slot].label[0].toUpperCase()}${SLOT_SPECS[slot].label.slice(1)} front-runner: ${top.entity.name} — ${pct(top.consensus)}% consensus, ${pct(top.fairness)}% fair.${low && lowFit < 0.35 ? ` ${low} is least served (${pct(lowFit)}%).` : ""}`,
  });
}

function usedIds(ctx: Ctx): string[] {
  return (ctx.base?.stops ?? []).flatMap((s) => (s.entity ? [s.entity.id] : []));
}

// ---------------------------------------------------------------------------
// Tools the LLM can call (also used by the deterministic planner)
// ---------------------------------------------------------------------------

function activityTag(ctx: Ctx, word?: string): Promise<string | undefined> {
  if (!word) return Promise.resolve(undefined);
  const known = ACTIVITY_WORDS.find(([re]) => re.test(word))?.[1];
  return step(ctx, "find_tags", `Looking up Qloo venue tags for “${word}”`, async () => {
    const tags = await ctx.qloo.findTags(word);
    const cat = tags.find((t) => /category:place/.test(t.id))?.id ?? known;
    return { value: cat, summary: cat ? `Using ${cat.split(":").pop()?.replace(/_/g, " ")}` : "No venue tag — keeping the default mix" };
  }).catch(() => known);
}

async function toolSearchSlot(ctx: Ctx, a: Record<string, unknown>) {
  const slot = String(a.slot) as Slot;
  if (!SLOTS.includes(slot)) return { error: `slot must be one of ${SLOTS.join(", ")}` };
  const c: Constraints = { ...ctx.constraints };
  if (a.price_max) c.priceMax = Math.max(1, Math.min(4, Number(a.price_max)));
  if (a.quiet === true) c.quiet = true;
  if (Array.isArray(a.dietary) && a.dietary.length) c.dietary = (a.dietary as string[]).map(String);
  if (Array.isArray(a.dietary_for) && a.dietary_for.length) c.dietaryFor = (a.dietary_for as string[]).map(String);
  if (a.activity_type) c.activity = String(a.activity_type);
  ctx.constraints = c;
  const tag = slot === "activity" ? await activityTag(ctx, c.activity) : undefined;
  await scoreSlots(ctx, [slot], tag ? { activity: { tagIds: [tag] } } : {});
  return { slot, constraints: c, shortlist: shortlist(ctx, slot) };
}

async function toolBridge(ctx: Ctx, a: Record<string, unknown>) {
  const slot = String(a.slot) as Slot;
  const member = String(a.member);
  if (!["dinner", "activity", "film"].includes(slot)) return { error: "find_bridge works for dinner, activity or film" };
  if (!ctx.members.some((m) => m.name === member)) return { error: `unknown member ${member}` };
  const before = ctx.slots[slot]?.[0];
  const best = Math.max(0, ...(ctx.slots[slot] ?? []).slice(0, 3).map((c) => c.memberAffinity[member] ?? 0));
  if (best >= 0.5 && a.force !== true)
    return { skipped: `${member} already has a ${pct(best)}% fit among the top ${SLOT_SPECS[slot].label} picks — no bridge needed. Choose from the shortlist.` };
  ctx.bridgeTried.add(slot);
  const list = await step(ctx, "find_bridge", `Bridge search: starting from ${member}’s taste for the ${SLOT_SPECS[slot].label}`, async () => {
    const tag = slot === "activity" && ctx.constraints.activity ? await activityTag(ctx, ctx.constraints.activity) : undefined;
    const l = await bridgeSearch(ctx.qloo, ctx.members, slot, member, ctx.ranges[slot], {
      city: ctx.city,
      constraints: ctx.constraints,
      excludeIds: usedIds(ctx),
      tagIds: tag ? [tag] : undefined,
    });
    const b = l[0];
    return {
      value: l,
      summary: b ? `${b.entity.name}: ${member} ${pct(b.memberAffinity[member])}% fit · consensus ${pct(b.consensus)}% · fairness ${pct(b.fairness)}%` : "No bridge found",
    };
  }).catch(() => [] as Candidate[]);
  if (list.length) register(ctx, slot, list.slice(0, 4), "merge");
  return {
    slot,
    member,
    current_top: before ? { name: before.entity.name, fit_for_member: pct(before.memberAffinity[member]), consensus: pct(before.consensus), fairness: pct(before.fairness) } : null,
    bridges: list.slice(0, 3).map((c) => shortlist(ctx, slot, 99).find((s) => s.name === c.entity.name)).filter(Boolean),
  };
}

async function toolSetCity(ctx: Ctx, a: Record<string, unknown>) {
  const city = String(a.city ?? "").trim().slice(0, 80);
  if (!city) return { error: "city required" };
  ctx.city = city;
  ctx.ranges.dinner = undefined;
  ctx.ranges.activity = undefined;
  await scoreSlots(ctx, ["dinner", "activity"]);
  return { city, dinner: shortlist(ctx, "dinner"), activity: shortlist(ctx, "activity") };
}

// ---------------------------------------------------------------------------
// Finalize + critic
// ---------------------------------------------------------------------------

interface StopArg {
  ref?: string;
  blurb?: string;
  why?: Record<string, string>;
}
interface FinalArgs {
  title?: string;
  summary?: string;
  change_note?: string;
  dinner?: StopArg;
  activity?: StopArg;
  film?: StopArg;
  playlist?: { refs?: string[]; blurb?: string; why?: Record<string, string> };
}

const LEFT_OUT = 0.25;

/** The critic's rule for one pick: someone below 25% taste fit on a pick with < 40% fairness. */
export function leftOut(c: Candidate): { member: string; fit: number } | null {
  const low = Object.entries(c.memberAffinity).sort((a, b) => a[1] - b[1])[0];
  return low && low[1] < LEFT_OUT && c.fairness < 0.4 ? { member: low[0], fit: low[1] } : null;
}

/** Critic: someone below LEFT_OUT on a pick with poor fairness, and no bridge tried yet. */
function critique(ctx: Ctx, chosen: Partial<Record<Slot, Candidate>>): { slot: Slot; member: string; fit: number; name: string }[] {
  const issues: { slot: Slot; member: string; fit: number; name: string }[] = [];
  for (const slot of ["dinner", "activity", "film"] as Slot[]) {
    const c = chosen[slot];
    if (!c || ctx.bridgeTried.has(slot)) continue;
    const low = leftOut(c);
    if (low) issues.push({ slot, member: low.member, fit: low.fit, name: c.entity.name });
  }
  return issues;
}

function pickRef(ctx: Ctx, slot: Slot, ref: string | undefined): Candidate | null {
  if (!ref) return null;
  if (ref === "keep") {
    const s = ctx.base?.stops.find((x) => x.slot === slot);
    return s ? candidateFromStop(s) : null;
  }
  const hit = ctx.refs.get(ref);
  return hit && hit.slot === slot ? hit.c : null;
}

function finalize(ctx: Ctx, a: FinalArgs): { ok: true } | { error: string } {
  const members = names(ctx);
  const dinner = pickRef(ctx, "dinner", a.dinner?.ref);
  const activity = pickRef(ctx, "activity", a.activity?.ref);
  if (!dinner) return { error: `dinner.ref "${a.dinner?.ref}" is not a dinner ref from the shortlists` };
  if (!activity) return { error: `activity.ref "${a.activity?.ref}" is not an activity ref from the shortlists` };
  if (dinner.entity.id === activity.entity.id) return { error: "dinner and activity must be different venues" };
  // refining: anything the model didn't (validly) replace stays as it was
  if (ctx.base) {
    if (!pickRef(ctx, "film", a.film?.ref) && ctx.base.stops.some((s) => s.slot === "film")) a.film = { ref: "keep" };
    const okArtists = (a.playlist?.refs ?? []).filter((r) => pickRef(ctx, "playlist", r)).length;
    if (okArtists < 3 && a.playlist?.refs?.[0] !== "keep") a.playlist = { ...(a.playlist ?? {}), refs: ["keep"] };
  }
  const film = pickRef(ctx, "film", a.film?.ref) ?? undefined;
  const fresh = (slot: "dinner" | "activity" | "film", c?: Candidate) => (a[slot]?.ref === "keep" ? undefined : c);
  const issues = critique(ctx, { dinner: fresh("dinner", dinner), activity: fresh("activity", activity), film: fresh("film", film) });
  if (issues.length) {
    for (const i of issues) {
      ctx.bridgeTried.add(i.slot);
      const text = `${i.member} is left out of the ${SLOT_SPECS[i.slot].label}: ${pct(i.fit)}% taste fit for ${i.name}. Asking for a bridge pick.`;
      ctx.critiques.push(text);
      ctx.emit({ type: "critique", text });
    }
    return {
      error: `Critic rejected the draft: ${issues.map((i) => `${i.member} has ${pct(i.fit)}% fit on ${i.slot} (${i.name})`).join("; ")}. Call find_bridge for each (slot, member), then finalize again — keep the original only if the bridge is clearly worse for the group, and say so in the summary.`,
    };
  }

  // playlist
  const keepPlaylist = a.playlist?.refs?.[0] === "keep" ? ctx.base?.stops.find((s) => s.slot === "playlist") : undefined;
  let artists = (a.playlist?.refs ?? []).map((r) => pickRef(ctx, "playlist", r)).filter(Boolean) as Candidate[];
  if (!keepPlaylist && artists.length < 3) artists = (ctx.slots.playlist ?? []).slice(0, 5);
  artists = ensureEveryoneHasOne(artists, ctx.slots.playlist ?? [], members);

  const base = ctx.base;
  const keepCopy = (slot: Slot, arg: StopArg | undefined, c: Candidate) => {
    const old = base?.stops.find((s) => s.slot === slot);
    if (arg?.ref === "keep" && old) return old; // unchanged stop keeps its copy
    return stopFrom(slot, c, (!hasBanned(arg?.blurb) && arg?.blurb) || pitch(c), cleanWhy(arg?.why), members);
  };
  const stops = [keepCopy("dinner", a.dinner, dinner), keepCopy("activity", a.activity, activity)];
  if (keepPlaylist) stops.push(keepPlaylist);
  else if (artists.length) stops.push(playlistStop(artists, hasBanned(a.playlist?.blurb) ? undefined : a.playlist?.blurb, cleanWhy(a.playlist?.why), members));
  if (film) stops.push(keepCopy("film", a.film, film));

  for (const s of stops)
    if (s.bridgeFor && !base?.stops.some((b) => b.slot === s.slot && b.entity?.id === s.entity?.id)) {
      const top = ctx.slots[s.slot]?.find((c) => !c.bridgeFor);
      const m = s.bridgeFor;
      const note = `Bridge for ${m}: ${s.entity?.name} lifts ${m} to ${pct(s.memberScores?.[m])}%${top ? ` (vs ${pct(top.memberAffinity[m])}% at ${top.entity.name})` : ""}, fairness ${pct(s.fairness)}%.`;
      ctx.critiques.push(note);
      ctx.emit({ type: "critique", text: note });
    }

  ctx.plan = {
    title: (a.title || base?.title || `${dinner.entity.name} → ${activity.entity.name}`).slice(0, 80),
    summary: a.summary || base?.summary || "",
    city: ctx.city,
    vibe: ctx.request.vibe,
    members,
    stops,
    mode: { qloo: ctx.qloo.mode, planner: ctx.planner, model: ctx.model },
    createdAt: new Date().toISOString(),
    circle: circleOf(ctx.members),
    constraints: ctx.constraints,
    tasteMap: ctx.tasteMap ?? base?.tasteMap,
    ranges: ctx.ranges,
    critiques: [...(base?.critiques ?? []), ...ctx.critiques].slice(-6),
    changes: [...(base?.changes ?? []), ...(a.change_note ? [a.change_note] : [])].slice(-6),
    stats: { qlooCalls: ctx.qloo.calls(), llmTurns: ctx.llmTurns, ms: Date.now() - ctx.startedAt },
  };
  return { ok: true };
}

/** Make sure every member has at least one artist on the playlist that fits them. */
function ensureEveryoneHasOne(chosen: Candidate[], pool: Candidate[], members: string[]): Candidate[] {
  const out = [...chosen].slice(0, 6);
  for (const m of members) {
    if (out.some((c) => (c.memberAffinity[m] ?? 0) >= 0.6)) continue;
    const best = pool.filter((c) => !out.includes(c)).sort((x, y) => (y.memberAffinity[m] ?? 0) - (x.memberAffinity[m] ?? 0))[0];
    if (best && (best.memberAffinity[m] ?? 0) > 0) {
      if (out.length >= 5) out.pop();
      out.push(best);
    }
  }
  return out;
}

/** Drop draft reasons that use banned words; the grounded default line replaces them. */
function cleanWhy(why: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(why ?? {}).filter(([, v]) => !hasBanned(v)));
}

function playlistStop(artists: Candidate[], blurb: string | undefined, why: Record<string, string> | undefined, members: string[]) {
  const scores = Object.fromEntries(members.map((m) => [m, Math.max(...artists.map((c) => c.memberAffinity[m] ?? 0))]));
  const drivers = Object.fromEntries(
    members.map((m) => {
      const mine = [...artists].sort((x, y) => (y.memberAffinity[m] ?? 0) - (x.memberAffinity[m] ?? 0))[0];
      return [m, mine ? [{ name: mine.entity.name, kind: "artist" as const, weight: mine.memberAffinity[m] ?? 0 }, ...(mine.drivers[m] ?? []).slice(0, 1)] : []];
    }),
  );
  const fallbackWhy = (m: string) => {
    const mine = [...artists].sort((x, y) => (y.memberAffinity[m] ?? 0) - (x.memberAffinity[m] ?? 0))[0];
    if (!mine) return "";
    const d = mine.drivers[m]?.[0]?.name;
    return `Listen for ${mine.entity.name}${d ? ` — Qloo links it to your ${d}` : ""} (${pct(mine.memberAffinity[m])}% fit).`;
  };
  const vals = members.map((m) => scores[m]);
  return {
    slot: "playlist" as const,
    title: "Soundtrack for the ride",
    entities: artists.map((c) => slim(c.entity)),
    blurb: blurb || `${artists.length} artists where your music overlaps — queue it between stops.`,
    whyByMember: Object.fromEntries(members.map((m) => [m, why?.[m]?.trim() || fallbackWhy(m)])),
    consensus: artists.reduce((s, c) => s + c.consensus, 0) / artists.length,
    fairness: Math.min(...vals) / Math.max(...vals, 1e-6),
    memberScores: scores,
    drivers,
  };
}

function pitch(c: Candidate): string {
  const e = c.entity;
  if (e.kind === "movie" || e.kind === "tv_show") return `${e.subtitle ? `${e.subtitle}. ` : ""}${pct(c.consensus)}% group consensus — save it for the next movie night.`;
  const what = (e.subtitle || "spot").toLowerCase();
  const vibe = e.facets?.vibe?.slice(0, 2).map((v) => v.toLowerCase());
  return `${/^[aeiou]/.test(what) ? "An" : "A"} ${what}${e.neighborhood ? ` in ${e.neighborhood}` : ""}${vibe?.length ? `, ${listify(vibe)}` : ""} — ${pct(c.consensus)}% group consensus.`;
}

// ---------------------------------------------------------------------------
// Phase B: LLM tool loop
// ---------------------------------------------------------------------------

function whySchema(members: string[]) {
  return { type: "object", properties: Object.fromEntries(members.map((m) => [m, { type: "string" }])), required: members };
}

function toolDefs(members: string[], refine: boolean): ToolDef[] {
  const stop = (desc: string) => ({
    type: "object",
    description: desc,
    properties: {
      ref: { type: "string", description: refine ? "A ref from a shortlist (d3, a7…) or \"keep\" to keep the current stop" : "A ref from the shortlist, e.g. d2" },
      blurb: { type: "string", description: "One sentence pitch, facts only from the data" },
      why: { ...whySchema(members), description: "member → one sentence in second person naming THEIR favourites from `because`" },
    },
    required: ["ref", "blurb", "why"],
  });
  const defs: ToolDef[] = [
    {
      type: "function",
      function: {
        name: "search_slot",
        description:
          "Re-query Qloo for one slot with constraints (price, quiet, dietary, activity type). Returns a fresh scored shortlist. Use when the user asks for a change or when the current shortlist breaks a constraint.",
        parameters: {
          type: "object",
          properties: {
            slot: { type: "string", enum: ["dinner", "activity", "playlist", "film"] },
            price_max: { type: "integer", minimum: 1, maximum: 4, description: "Qloo price level 1 ($) – 4 ($$$$)" },
            quiet: { type: "boolean", description: "exclude venues Qloo tags as loud" },
            dietary: { type: "array", items: { type: "string", enum: ["vegetarian", "vegan", "halal", "gluten free"] } },
            dietary_for: { type: "array", items: { type: "string" }, description: "members who need the dietary option" },
            activity_type: { type: "string", description: "e.g. karaoke, jazz, comedy, live music, cocktail, wine, pub, dance" },
          },
          required: ["slot"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_bridge",
        description:
          "When one member is left out of a pick (low fit), search Qloo starting from THAT member's own favourites, then score the results for everyone. Returns bridge candidates with refs.",
        parameters: {
          type: "object",
          properties: { slot: { type: "string", enum: ["dinner", "activity", "film"] }, member: { type: "string", enum: members } },
          required: ["slot", "member"],
        },
      },
    },
  ];
  if (refine)
    defs.push({
      type: "function",
      function: {
        name: "set_city",
        description: "Move the night to another city: re-scores dinner and activity there (playlist and film stay).",
        parameters: { type: "object", properties: { city: { type: "string", description: "Full city name, e.g. 'Ho Chi Minh City' for Saigon" } }, required: ["city"] },
      },
    });
  defs.push({
    type: "function",
    function: {
      name: "finalize_itinerary",
      description: "Publish the itinerary. Every ref must come from a shortlist returned so far" + (refine ? " (or \"keep\")." : "."),
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "max 7 words, specific to this group, no colon" },
          summary: { type: "string", description: "Two sentences: why this night works for THIS group, mention the trade-off you made" },
          ...(refine ? { change_note: { type: "string", description: "One sentence: what changed and why (e.g. 'Swapped the bar for a quieter wine bar Qloo tags as calm.')" } } : {}),
          dinner: stop("Dinner"),
          activity: stop("After-dinner activity (bar, venue, show) — not another restaurant"),
          film: stop("Next movie night"),
          playlist: {
            type: "object",
            properties: {
              refs: { type: "array", items: { type: "string" }, description: refine ? "4-5 p refs, or [\"keep\"]" : "4-5 p refs" },
              blurb: { type: "string" },
              why: whySchema(members),
            },
            required: ["refs", "blurb", "why"],
          },
        },
        required: ["title", "summary", "dinner", "activity", "playlist", ...(refine ? ["change_note"] : [])],
      },
    },
  });
  return defs;
}

const COPY_RULES = [
  "Copy rules — whyByMember: second person, max 24 words, never start with the member's name.",
  "Name ONLY favourites listed for that member in `because` for that pick, and connect one concrete quality of the favourite to one concrete quality of the pick from `about`.",
  "Good: 'The late-night hush you love in Lost in Translation, in a moderate-noise room in the West Village.' Good: 'Kendrick Lamar and Moonlight are what pull this one your way — a loud, late room to match.' Bad: 'The vibe matches your love of Radiohead.'",
  "blurb: say plainly what the place is (from `about`: category, neighbourhood, price, noise) and why it suits this group — one sentence, no hype.",
  "If a member has no `because` or fit < 30, say honestly it's a stretch chosen for the group, and what's in it for them.",
  "Banned words: vibe(s), resonate, perfect(ly), curated, elevate, journey, delight. Never invent dishes, prices, menus or facts not in the data.",
  "title: max 6 words, specific to this group and city, no colon. summary: two plain sentences, name the trade-off you made.",
].join(" ");

const SYSTEM_PLAN = [
  "You are TasteCircle's planning agent: one night out for friends whose tastes clash.",
  "You get Qloo-scored shortlists per slot. consensus = fit for the whole group; fairness = least-happy/happiest member; fit = each friend's taste fit 0-100 (relative to the pool Qloo found); because = which of THAT friend's favourites Qloo's explainability credits.",
  "Pick dinner → activity → playlist (4-5 artists, everyone should have one) → film so nobody is left out. Prefer slightly lower consensus with much better fairness.",
  "If anyone has fit < 25 on the dinner/activity/film you intend to pick, call find_bridge(slot, member) first. Sense-check `about`: dinner = somewhere to eat; activity = bar, venue, show or experience, not another restaurant; if a shortlist breaks the vibe or constraints, call search_slot.",
  "Be efficient: most plans need 0-2 tool calls before finalize_itinerary; put independent calls in ONE turn. Don't re-search playlist or film unless something is wrong.",
  "Before tool calls, write ONE short sentence (max 20 words) in plain words saying what you're checking — the group sees it live.",
  COPY_RULES,
].join(" ");

const SYSTEM_REFINE = [
  "You are TasteCircle's planning agent, refining an itinerary the group already has.",
  "The user asks for a change. Re-query Qloo for every stop that must change (search_slot with the constraints, find_bridge, or set_city to move cities) — never invent a venue from your own knowledge.",
  "Keep stops that don't need to change with ref \"keep\" (copy optional). Then call finalize_itinerary with a change_note saying what changed and what Qloo data backs it (e.g. tagged quiet, price level).",
  "Before tool calls, write ONE short sentence (max 20 words) saying what you'll change.",
  COPY_RULES,
].join(" ");

function groupLine(ctx: Ctx) {
  return ctx.members
    .map((m) => `${m.name}: ${m.tastes.filter((t) => t.entity).map((t) => `${t.entity!.name} (${t.entity!.kind.replace("_", " ")})`).join(", ") || "(nothing matched)"}`)
    .join(" | ");
}

async function llmLoop(ctx: Ctx, cfg: LlmConfig, deadline: number, userText: string, refine: boolean): Promise<Plan> {
  const members = names(ctx);
  const tools = toolDefs(members, refine);
  const messages: ChatMessage[] = [
    { role: "system", content: refine ? SYSTEM_REFINE : SYSTEM_PLAN },
    { role: "user", content: userText },
  ];
  const MAX_TURNS = 7;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const forceFinal = turn >= MAX_TURNS - 2 || deadline - Date.now() < 15_000;
    const msg = await chat(
      cfg,
      {
        messages,
        tools,
        tool_choice: forceFinal ? { type: "function", function: { name: "finalize_itinerary" } } : "auto",
        max_tokens: 2200,
        temperature: 0.5,
      },
      deadline,
    );
    ctx.llmTurns++;
    messages.push(msg);
    if (msg.content?.trim() && msg.content.trim().length < 400) ctx.emit({ type: "thought", text: msg.content.trim() });
    if (!msg.tool_calls?.length) {
      messages.push({ role: "user", content: "Call a tool now — finalize_itinerary if you are done." });
      continue;
    }
    const results = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        const args = parseArgs(tc.function.arguments);
        let out: unknown;
        try {
          if (tc.function.name === "search_slot") out = await toolSearchSlot(ctx, args);
          else if (tc.function.name === "find_bridge") out = await toolBridge(ctx, args);
          else if (tc.function.name === "set_city" && refine) out = await toolSetCity(ctx, args);
          else if (tc.function.name === "finalize_itinerary") {
            out = await step(ctx, "finalize_itinerary", refine ? "Rewriting the plan" : "Writing the itinerary", async () => {
              const r = finalize(ctx, args as FinalArgs);
              if ("error" in r) throw new Error(r.error);
              return { value: r, summary: `Itinerary ready: “${ctx.plan!.title}”` };
            }).catch((e: Error) => ({ error: e.message }));
          } else out = { error: `unknown tool ${tc.function.name}` };
        } catch (err) {
          out = { error: (err as Error).message };
        }
        return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) };
      }),
    );
    messages.push(...results);
    if (ctx.plan) return ctx.plan;
  }
  throw new Error("agent ran out of turns");
}

function planPrompt(ctx: Ctx): string {
  const lists = Object.fromEntries(SLOTS.map((s) => [s, shortlist(ctx, s)]).filter(([, l]) => (l as unknown[]).length));
  const c = ctx.constraints;
  const cons = [c.priceMax ? `price ≤ ${"$".repeat(c.priceMax)}` : "", c.quiet ? "quiet places" : "", c.dietary?.length ? `${c.dietary.join("/")} for ${c.dietaryFor?.join(", ") || "the group"}` : ""].filter(Boolean).join("; ");
  return [
    `City: ${ctx.city}.${ctx.request.vibe ? ` Vibe: ${ctx.request.vibe}.` : ""}${cons ? ` Constraints: ${cons}.` : ""}`,
    `Group: ${groupLine(ctx)}`,
    ctx.tasteMap ? tasteMapBrief(ctx.tasteMap) : "",
    `Shortlists: ${JSON.stringify(lists)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic planner (no LLM / fallback) — same critic and bridge
// ---------------------------------------------------------------------------

const fairest = (list: Candidate[], not?: string) =>
  [...list].filter((c) => c.entity.id !== not).sort((a, b) => b.consensus + 0.3 * b.fairness - (a.consensus + 0.3 * a.fairness))[0];

async function deterministic(ctx: Ctx, opts: { keep?: Slot[]; changeNote?: string } = {}): Promise<Plan> {
  const keep = new Set(opts.keep ?? []);
  const ref = (slot: Slot, c?: Candidate) => (c ? [...ctx.refs.entries()].find(([, v]) => v.slot === slot && v.c === c)?.[0] : undefined);
  const choose = (slot: Slot, not?: string) => (keep.has(slot) ? "keep" : ref(slot, fairest(ctx.slots[slot] ?? [], not)));

  const dinnerTop = keep.has("dinner") ? candidateFromStop(ctx.base!.stops.find((s) => s.slot === "dinner")!) : fairest(ctx.slots.dinner ?? []);
  if (!dinnerTop) throw new Error(`Qloo found no dinner spots for this group in ${ctx.city}. Try a bigger city nearby.`);
  const top = { dinner: dinnerTop, activity: keep.has("activity") ? candidateFromStop(ctx.base!.stops.find((s) => s.slot === "activity")!) : fairest(ctx.slots.activity ?? [], dinnerTop.entity.id), film: keep.has("film") ? undefined : fairest(ctx.slots.film ?? []) };
  if (!top.activity) throw new Error(`Qloo found no bars or venues for this group in ${ctx.city}.`);

  // critic → bridge (only for slots we're choosing now)
  for (const i of critique(ctx, { dinner: keep.has("dinner") ? undefined : top.dinner, activity: keep.has("activity") ? undefined : top.activity!, film: top.film })) {
    const text = `${i.member} is left out of the ${SLOT_SPECS[i.slot].label}: ${pct(i.fit)}% taste fit for ${i.name}. Trying a bridge pick.`;
    ctx.critiques.push(text);
    ctx.emit({ type: "critique", text });
    const r = await toolBridge(ctx, { slot: i.slot, member: i.member });
    const b = (r as { bridges?: { ref?: string }[] }).bridges?.[0];
    const cand = b?.ref ? ctx.refs.get(b.ref)?.c : undefined;
    const orig = top[i.slot as "dinner" | "activity" | "film"]!;
    if (cand && cand.entity.id !== top.dinner.entity.id && (cand.memberAffinity[i.member] ?? 0) > i.fit && cand.consensus >= orig.consensus * 0.8) {
      top[i.slot as "dinner" | "activity" | "film"] = cand;
    } else {
      const t = `Kept ${orig.entity.name}: the best bridge for ${i.member} cost the group more than it gave.`;
      ctx.critiques.push(t);
      ctx.emit({ type: "critique", text: t });
    }
  }

  const d = keep.has("dinner") ? "keep" : ref("dinner", top.dinner);
  const a = keep.has("activity") ? "keep" : ref("activity", top.activity);
  const f = keep.has("film") ? "keep" : top.film ? ref("film", top.film) : undefined;
  const members = names(ctx);
  void choose;
  const res = await step(ctx, "finalize_itinerary", ctx.base ? "Rewriting the plan" : "Writing the itinerary", async () => {
    const r = finalize(ctx, {
      title: ctx.base?.title && !ctx.base.title.includes("→") ? ctx.base.title : `${top.dinner.entity.name} → ${top.activity!.entity.name}`,
      summary:
        ctx.base?.summary ??
        `Every stop was scored against all ${members.length} of your tastes, and the fairest high-consensus option won. ${listify(members)} each get something that's genuinely theirs.`,
      change_note: opts.changeNote,
      dinner: { ref: d, why: keep.has("dinner") ? undefined : Object.fromEntries(members.map((m) => [m, defaultWhy(m, top.dinner)])) },
      activity: { ref: a, why: keep.has("activity") ? undefined : Object.fromEntries(members.map((m) => [m, defaultWhy(m, top.activity!)])) },
      film: f ? { ref: f } : undefined,
      playlist: { refs: keep.has("playlist") ? ["keep"] : (ctx.slots.playlist ?? []).slice(0, 5).map((c) => ref("playlist", c)!).filter(Boolean) },
    });
    if ("error" in r) throw new Error(r.error);
    return { value: r, summary: `Itinerary ready: “${ctx.plan!.title}”` };
  });
  void res;
  return ctx.plan!;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const BUDGET_MS = Number(env("TASTECIRCLE_LLM_BUDGET_MS")) || 60_000;

function withStats(ctx: Ctx, p: Plan): Plan {
  return { ...p, stats: { qlooCalls: ctx.qloo.calls(), llmTurns: ctx.llmTurns + (p === ctx.plan ? 0 : 1), ms: Date.now() - ctx.startedAt } };
}

function statusLine(qloo: QlooClient, cfg: LlmConfig | null) {
  return `Qloo: ${qloo.mode === "live" ? "live API" : "sample data"} · Planner: ${cfg ? cfg.model : "rule-based"}`;
}

export async function runAgent(request: PlanRequest, emit: Emit, qloo: QlooClient = getQloo()): Promise<Plan> {
  const cfg = llmConfig();
  const ctx = newCtx(qloo, request, emit);
  emit({ type: "status", message: statusLine(qloo, cfg) });
  await resolveTastes(ctx);
  await Promise.all([tasteMapStep(ctx), scoreSlots(ctx, SLOTS)]);
  if (!ctx.slots.dinner?.length || !ctx.slots.activity?.length) {
    throw new Error(`Qloo didn’t return enough venues for this group in ${ctx.city}. Try the full city name (e.g. “Ho Chi Minh City”, “New York”).`);
  }
  if (cfg) {
    ctx.planner = "llm";
    ctx.model = cfg.model;
    emit({ type: "thought", text: `Shortlists scored. Handing them to ${cfg.model} to weigh consensus against fairness, re-query Qloo if needed, and explain each pick.` });
    try {
      const p = await llmLoop(ctx, cfg, Date.now() + BUDGET_MS, planPrompt(ctx), false);
      return withStats(ctx, await polishCopy(ctx, p, SLOTS));
    } catch (err) {
      emit({ type: "thought", text: `LLM planner stopped (${(err as Error).message.slice(0, 120)}); finishing from the scores already computed.` });
      ctx.planner = "deterministic";
      ctx.model = undefined;
    }
  }
  return deterministic(ctx);
}

/** Parse a change request without an LLM (deterministic mode / fallback). */
export function parseChange(message: string, members: string[]) {
  const m = message.toLowerCase();
  const c: Constraints = {};
  const slots = new Set<Slot>();
  let city: string | undefined;
  const cityMatch = message.match(/\b(?:move (?:it |us |the night )?to|in|to)\s+([A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+){0,3})\s*$/u);
  if (cityMatch) city = /saigon|sài gòn/i.test(cityMatch[1]) ? "Ho Chi Minh City" : cityMatch[1];
  if (/cheap|budget|less expensive|afford|broke/.test(m)) {
    c.priceMax = 2;
    slots.add("dinner").add("activity");
  }
  if (/quiet|calm|chill|low.?key|talk/.test(m)) {
    c.quiet = true;
    slots.add(/dinner|restaurant/.test(m) ? "dinner" : "activity");
  }
  const diet = m.match(/vegetarian|vegan|halal|gluten.?free/)?.[0];
  if (diet) {
    c.dietary = [diet.replace(/gluten.?free/, "gluten free")];
    c.dietaryFor = members.filter((n) => m.includes(n.toLowerCase()));
    slots.add("dinner");
  }
  const act = ACTIVITY_WORDS.find(([re]) => re.test(m));
  if (act) {
    c.activity = message.match(act[0])?.[0];
    slots.add("activity");
  }
  if (/bar|drinks|activity|after/.test(m) && !slots.size) slots.add("activity");
  if (/dinner|restaurant|food|eat/.test(m) && !slots.size) slots.add("dinner");
  if (/film|movie/.test(m)) slots.add("film");
  if (/music|playlist|song/.test(m)) slots.add("playlist");
  return { constraints: c, slots: [...slots], city };
}

export async function refineAgent(plan: Plan, message: string, emit: Emit, qloo: QlooClient = getQloo()): Promise<Plan> {
  if (!plan?.circle?.length || !plan.stops?.length) throw new Error("This plan can’t be refined (it was made by an older version). Plan the night again.");
  const cfg = llmConfig();
  const request: PlanRequest = { members: plan.members.map((n) => ({ name: n, tastes: { artist: [], movie: [], place: [], book: [] } })), city: plan.city, vibe: plan.vibe, constraints: plan.constraints };
  const ctx = newCtx(qloo, request, emit, plan);
  ctx.members = membersFromCircle(plan.circle);
  ctx.tasteMap = plan.tasteMap;
  emit({ type: "status", message: statusLine(qloo, cfg) });
  emit({ type: "thought", text: `Change request: “${message.slice(0, 160)}”` });

  if (cfg) {
    ctx.planner = "llm";
    ctx.model = cfg.model;
    const current = plan.stops.map((s) => ({
      slot: s.slot,
      name: s.entity?.name ?? s.entities?.map((e) => e.name).join(", "),
      about: s.entity?.subtitle,
      price: s.entity?.priceLevel,
      noise: s.entity?.facets?.noise,
      fit: Object.fromEntries(Object.entries(s.memberScores ?? {}).map(([k, v]) => [k, pct(v)])),
    }));
    // Pre-parse the obvious constraints so they apply to every Qloo search the model runs.
    const parsed = parseChange(message, plan.members);
    ctx.constraints = { ...ctx.constraints, ...parsed.constraints };
    const text = [
      `City: ${plan.city}. Group: ${groupLine(ctx)}`,
      `Current itinerary: ${JSON.stringify(current)}`,
      `Constraints (already applied to every search you run): ${JSON.stringify(ctx.constraints)}`,
      parsed.city && parsed.city.toLowerCase() !== plan.city.toLowerCase() ? `City change detected → call set_city("${parsed.city}").` : "",
      parsed.slots.length ? `Slots the request most likely touches: ${parsed.slots.join(", ")}.` : "",
      `User request: ${message.slice(0, 400)}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const p = await llmLoop(ctx, cfg, Date.now() + 45_000, text, true);
      const key = (st: Plan["stops"][number]) => st.entity?.id ?? st.entities?.map((e) => e.id).join() ?? "";
      const changed = p.stops.filter((st) => key(st) !== key(plan.stops.find((x) => x.slot === st.slot) ?? ({} as Plan["stops"][number]))).map((st) => st.slot);
      return withStats(ctx, { ...(await polishCopy(ctx, p, changed)), title: p.title, summary: p.summary });
    } catch (err) {
      emit({ type: "thought", text: `LLM stopped (${(err as Error).message.slice(0, 100)}); applying the change with the rule-based planner.` });
      ctx.planner = "deterministic";
      ctx.model = undefined;
    }
  }
  // deterministic refine
  const parsed = parseChange(message, plan.members);
  ctx.constraints = { ...ctx.constraints, ...parsed.constraints };
  let redo = parsed.slots;
  if (parsed.city && parsed.city.toLowerCase() !== plan.city.toLowerCase()) {
    ctx.city = parsed.city;
    ctx.ranges.dinner = ctx.ranges.activity = undefined;
    redo = [...new Set<Slot>([...redo, "dinner", "activity"])];
  }
  if (!redo.length) redo = ["activity"];
  const tag = redo.includes("activity") ? await activityTag(ctx, ctx.constraints.activity) : undefined;
  await scoreSlots(ctx, redo, tag ? { activity: { tagIds: [tag] } } : {});
  const keep = SLOTS.filter((s) => !redo.includes(s));
  const note = `Re-ran Qloo for ${listify(redo)}${parsed.city ? ` in ${ctx.city}` : ""}${parsed.constraints.priceMax ? ", capped at $$" : ""}${parsed.constraints.quiet ? ", skipping venues tagged loud" : ""}${parsed.constraints.dietary ? `, with ${parsed.constraints.dietary.join("/")} options` : ""}.`;
  return deterministic(ctx, { keep, changeNote: note });
}
