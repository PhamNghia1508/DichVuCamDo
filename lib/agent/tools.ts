// Tools the planning agent can call. Each tool wraps one or more Qloo calls and
// returns a compact JSON summary that fits comfortably in an LLM context.

import type { QlooClient } from "../qloo";
import type { Candidate, Entity, ItineraryStop, Plan, PlanRequest, ResolvedMember, TargetKind, TasteKind } from "../types";
import { groupConsensus } from "./consensus";

export interface ToolContext {
  qloo: QlooClient;
  request: PlanRequest;
  members: ResolvedMember[] | null;
  candidates: Map<string, Candidate>;
  used: Set<string>;
  plan: Plan | null;
  planner: Plan["mode"]["planner"];
  model?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  label: (args: Record<string, unknown>) => string;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<{ result: unknown; summary: string }>;
}

const pct = (n: number) => Math.round(n * 100);

function short(c: Candidate) {
  return {
    id: c.entity.id,
    name: c.entity.name,
    about: c.entity.subtitle,
    tags: c.entity.tags?.slice(0, 4),
    consensus: pct(c.consensus),
    fairness: pct(c.fairness),
    per_member: Object.fromEntries(Object.entries(c.memberAffinity).map(([k, v]) => [k, pct(v)])),
    because: c.drivers,
  };
}

const STOP_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Candidate id from group_consensus" },
    blurb: { type: "string", description: "One sentence pitch" },
    whyByMember: { type: "object", description: "member name -> one sentence", additionalProperties: { type: "string" } },
  },
  required: ["id", "blurb", "whyByMember"],
};

export const TOOLS: ToolSpec[] = [
  {
    name: "resolve_group_tastes",
    description:
      "Resolve every member's free-text favourites (artists, movies, restaurants, books) to Qloo entities via Qloo /search. Call this first.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    label: () => "Resolving everyone's favourites with Qloo search",
    async run(ctx) {
      const members: ResolvedMember[] = [];
      for (const m of ctx.request.members) {
        const jobs: Promise<{ input: string; kind: TasteKind; entity: Entity | null }>[] = [];
        for (const kind of Object.keys(m.tastes) as TasteKind[])
          for (const input of m.tastes[kind] ?? [])
            if (input.trim())
              jobs.push(
                ctx.qloo
                  .search(input.trim(), kind)
                  .then((entity) => ({ input, kind, entity }))
                  .catch(() => ({ input, kind, entity: null })),
              );
        members.push({ name: m.name, tastes: await Promise.all(jobs) });
      }
      ctx.members = members;
      const found = members.reduce((n, m) => n + m.tastes.filter((t) => t.entity).length, 0);
      const total = members.reduce((n, m) => n + m.tastes.length, 0);
      return {
        summary: `Matched ${found}/${total} favourites across ${members.length} people`,
        result: members.map((m) => ({
          member: m.name,
          tastes: m.tastes.map((t) => ({ kind: t.kind, input: t.input, matched: t.entity?.name ?? null })),
        })),
      };
    },
  },
  {
    name: "find_tags",
    description:
      "Look up valid Qloo tag IDs by keyword (Qloo /v2/tags), e.g. 'restaurant' for dinner spots or 'bar' / 'music venue' / 'nightlife' for the activity. Use returned ids in group_consensus.tag_ids.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword, e.g. 'restaurant', 'cocktail bar', 'live music'" } },
      required: ["query"],
      additionalProperties: false,
    },
    label: (a) => `Looking up Qloo tags for “${a.query}”`,
    async run(ctx, args) {
      const tags = await ctx.qloo.findTags(String(args.query ?? ""));
      return { summary: tags.length ? `Found ${tags.length} tag(s): ${tags.slice(0, 3).map((t) => t.name).join(", ")}` : "No tags found", result: tags.slice(0, 8) };
    },
  },
  {
    name: "group_consensus",
    description:
      "Find picks the WHOLE group overlaps on. Calls Qloo /v2/insights once with everyone's tastes and once per member (filter.results.entities) and returns candidates ranked by consensus (harmonic-mean based, punishes leaving anyone out), with per-member affinity % and which of each member's favourites drove the pick. target: 'place' (needs city; use tag_ids to narrow to restaurants or to bars/venues), 'movie', or 'artist'.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["place", "movie", "artist"] },
        purpose: { type: "string", description: "What this search is for, e.g. 'dinner', 'after-dinner activity', 'playlist', 'film'" },
        tag_ids: { type: "array", items: { type: "string" }, description: "Optional Qloo tag ids from find_tags" },
        top: { type: "integer", minimum: 3, maximum: 10, description: "How many candidates to return (default 6)" },
      },
      required: ["target", "purpose"],
      additionalProperties: false,
    },
    label: (a) => `Scoring ${a.purpose ?? a.target} options for the whole group`,
    async run(ctx, args) {
      if (!ctx.members) throw new Error("Call resolve_group_tastes first.");
      const target = String(args.target) as TargetKind;
      const tagIds = Array.isArray(args.tag_ids) ? (args.tag_ids as string[]).filter(Boolean) : undefined;
      const list = await groupConsensus(ctx.qloo, ctx.members, target, {
        city: ctx.request.city,
        tagIds,
        excludeIds: [...ctx.used],
      });
      const fresh = list.filter((c) => !ctx.used.has(c.entity.id));
      fresh.forEach((c) => ctx.candidates.set(c.entity.id, c));
      const top = fresh.slice(0, Number(args.top) || 6);
      return {
        summary: top.length ? `Top ${String(args.purpose)}: ${top[0].entity.name} (${pct(top[0].consensus)}% consensus)` : "No candidates",
        result: top.map(short),
      };
    },
  },
  {
    name: "finalize_itinerary",
    description:
      "Publish the final shareable itinerary. Use only ids returned by group_consensus. whyByMember must have one short, specific sentence per member, written to that member in the second person (\"you\", never he/she/his/her), naming the favourites that group_consensus explainability says drove the pick. Never invent menu items, prices or facts not present in tool results.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Catchy title for the night, max 8 words" },
        summary: { type: "string", description: "Two sentences on why this night works for this group" },
        dinner: STOP_SCHEMA,
        activity: STOP_SCHEMA,
        film: STOP_SCHEMA,
        playlist: {
          type: "object",
          properties: {
            artist_ids: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
            blurb: { type: "string" },
            whyByMember: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["artist_ids", "blurb", "whyByMember"],
        },
      },
      required: ["title", "summary", "dinner", "activity", "playlist"],
    },
    label: () => "Writing the itinerary",
    async run(ctx, args) {
      const plan = buildPlan(ctx, args as unknown as FinalizeArgs);
      ctx.plan = plan;
      return { summary: `Itinerary ready: “${plan.title}”`, result: { ok: true } };
    },
  },
];

export interface StopArgs {
  id: string;
  blurb: string;
  whyByMember: Record<string, string>;
}
export interface FinalizeArgs {
  title: string;
  summary: string;
  dinner: StopArgs;
  activity: StopArgs;
  film?: StopArgs;
  playlist: { artist_ids: string[]; blurb: string; whyByMember: Record<string, string> };
}

function buildPlan(ctx: ToolContext, a: FinalizeArgs): Plan {
  const need = (id: string, what: string) => {
    const c = ctx.candidates.get(id);
    if (!c) throw new Error(`Unknown ${what} id "${id}". Use an id returned by group_consensus.`);
    return c;
  };
  const members = ctx.request.members.map((m) => m.name);
  const fillWhy = (why: Record<string, string> | undefined, c?: Candidate) =>
    Object.fromEntries(members.map((m) => [m, why?.[m] || (c ? defaultWhy(m, c) : "")]));

  const dinner = need(a.dinner.id, "dinner");
  const activity = need(a.activity.id, "activity");
  const artists = a.playlist.artist_ids.map((id) => need(id, "artist"));
  const stops: ItineraryStop[] = [
    { slot: "dinner", title: "Dinner", time: "7:00 PM", entity: dinner.entity, blurb: a.dinner.blurb, whyByMember: fillWhy(a.dinner.whyByMember, dinner), consensus: dinner.consensus, fairness: dinner.fairness },
    { slot: "activity", title: "Then", time: "9:00 PM", entity: activity.entity, blurb: a.activity.blurb, whyByMember: fillWhy(a.activity.whyByMember, activity), consensus: activity.consensus, fairness: activity.fairness },
    {
      slot: "playlist",
      title: "Soundtrack for the ride",
      entities: artists.map((c) => c.entity),
      blurb: a.playlist.blurb,
      whyByMember: fillWhy(a.playlist.whyByMember),
      consensus: artists.reduce((s, c) => s + c.consensus, 0) / artists.length,
      fairness: artists.reduce((s, c) => s + c.fairness, 0) / artists.length,
    },
  ];
  if (a.film?.id && ctx.candidates.has(a.film.id)) {
    const film = need(a.film.id, "film");
    stops.push({ slot: "film", title: "Next movie night", entity: film.entity, blurb: a.film.blurb, whyByMember: fillWhy(a.film.whyByMember, film), consensus: film.consensus, fairness: film.fairness });
  }
  return {
    title: a.title,
    summary: a.summary,
    city: ctx.request.city,
    vibe: ctx.request.vibe,
    members,
    stops,
    mode: { qloo: ctx.qloo.mode, planner: ctx.planner, model: ctx.model },
    createdAt: new Date().toISOString(),
  };
}

export function defaultWhy(member: string, c: Candidate): string {
  const drivers = c.drivers[member] ?? [];
  const score = pct(c.memberAffinity[member] ?? 0);
  if (drivers.length) return `Lines up with your love of ${listify(drivers.slice(0, 2))} (${score}% match for you).`;
  if (score >= 30) return `A ${score}% taste match for you on its own.`;
  return `Not your usual, but it scores well with the rest of the group — a good stretch pick.`;
}

export function listify(xs: string[]) {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
