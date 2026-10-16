// The TasteCircle planning agent.
//
// With LLM_API_KEY set: an OpenAI-compatible tool-calling loop. The model
// decides which tools to call (resolve → tags → consensus per slot →
// finalize), reads the per-member scores, and writes the explanations.
//
// Without an LLM key: a deterministic planner runs the same tools in a fixed
// order and writes templated explanations, so the app always works.

import { getQloo, type QlooClient } from "../qloo";
import type { AgentEvent, Candidate, Plan, PlanRequest } from "../types";
import { TOOLS, defaultWhy, listify, short, type FinalizeArgs, type Slot, type ToolContext } from "./tools";

type Emit = (e: AgentEvent) => void;

const env = (k: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[k] : undefined;

export function validateRequest(body: unknown): PlanRequest {
  const b = body as PlanRequest;
  if (!b || !Array.isArray(b.members)) throw new Error("members[] is required");
  const members = b.members
    .slice(0, 8)
    .map((m, i) => ({
      name: String(m?.name || `Friend ${i + 1}`).slice(0, 40),
      tastes: {
        artist: clean(m?.tastes?.artist),
        movie: clean(m?.tastes?.movie),
        place: clean(m?.tastes?.place),
        book: clean(m?.tastes?.book),
      },
    }))
    .filter((m) => Object.values(m.tastes).some((l) => l.length));
  if (members.length < 2) throw new Error("Add at least two people with at least one favourite each.");
  const names = new Set<string>();
  for (const m of members) {
    let n = m.name;
    for (let k = 2; names.has(n); k++) n = `${m.name} ${k}`;
    m.name = n;
    names.add(n);
  }
  const city = String(b.city || "").trim().slice(0, 80);
  if (!city) throw new Error("Which city are you going out in?");
  return { members, city, vibe: b.vibe ? String(b.vibe).slice(0, 120) : undefined };
}

function clean(list: unknown): string[] {
  return Array.isArray(list) ? list.map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 5) : [];
}

/** Hard wall-clock budget for the LLM part; after it the deterministic finisher completes from cached results. */
const BUDGET_MS = Number(env("TASTECIRCLE_LLM_BUDGET_MS")) || 75_000;

export async function runAgent(request: PlanRequest, emit: Emit, qloo: QlooClient = getQloo()): Promise<Plan> {
  const llmKey = env("LLM_API_KEY");
  const startedAt = Date.now();
  const ctx: ToolContext = {
    qloo,
    request,
    members: null,
    candidates: new Map(),
    used: new Set(),
    plan: null,
    planner: llmKey ? "llm" : "deterministic",
    model: llmKey ? env("LLM_MODEL") || "gpt-4o-mini" : undefined,
    slots: {},
  };
  emit({
    type: "status",
    message: `Qloo: ${qloo.mode === "live" ? "live API" : "mock data"} · Planner: ${llmKey ? ctx.model : "deterministic"}`,
  });

  if (llmKey) {
    try {
      // Steps every plan needs run up front (no LLM tokens spent on them):
      // resolve everyone's favourites, and look up the two place tags in parallel.
      await prepare(ctx, emit);
      await scoreAllSlots(ctx, emit);
      return await llmLoop(ctx, emit, llmKey, startedAt + BUDGET_MS);
    } catch (err) {
      emit({ type: "thought", text: `LLM planner stopped (${(err as Error).message.slice(0, 140)}); finishing from the scores already computed.` });
      ctx.planner = "deterministic";
      ctx.model = undefined;
    }
  }
  return deterministic(ctx, emit);
}

let seq = 0;
async function callTool(ctx: ToolContext, emit: Emit, name: string, args: Record<string, unknown>, id: string = `x${seq++}`) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  emit({ type: "tool_start", id, tool: name, label: tool.label(args), args });
  try {
    const { result, summary } = await tool.run(ctx, args);
    emit({ type: "tool_end", id, tool: name, summary, ok: true });
    return result;
  } catch (err) {
    const message = (err as Error).message;
    emit({ type: "tool_end", id, tool: name, summary: message, ok: false });
    return { error: message };
  }
}

const TAG_QUERIES = { dinner: "restaurant", activity: "bar music venue nightlife" } as const;

async function lookupTag(ctx: ToolContext, emit: Emit, query: string) {
  ctx.tags ??= {};
  if (query in ctx.tags) return ctx.tags[query];
  const tags = (await callTool(ctx, emit, "find_tags", { query })) as { id: string; type?: string }[] | { error: string };
  // Prefer Qloo's place *category* tags (urn:tag:category:place:…): they filter venues far more precisely than genre tags.
  const id = Array.isArray(tags)
    ? (tags.find((t) => /category:place/.test(t.id))?.id ?? tags.find((t) => /place/.test(t.type ?? t.id))?.id ?? tags[0]?.id)
    : undefined;
  ctx.tags[query] = id;
  return id;
}

const SLOT_CALLS: { slot: Slot; target: string; purpose: string; tagQuery?: string }[] = [
  { slot: "dinner", target: "place", purpose: "dinner", tagQuery: TAG_QUERIES.dinner },
  { slot: "activity", target: "place", purpose: "after-dinner activity", tagQuery: TAG_QUERIES.activity },
  { slot: "playlist", target: "artist", purpose: "shared playlist" },
  { slot: "film", target: "movie", purpose: "next movie night" },
];

/** Score every slot concurrently (the Qloo client queues/rate-limits); results land in ctx.slots. */
async function scoreAllSlots(ctx: ToolContext, emit: Emit) {
  await Promise.all(
    SLOT_CALLS.map(async ({ slot, target, purpose, tagQuery }) => {
      if (ctx.slots[slot]?.length) return;
      const tag = tagQuery ? await lookupTag(ctx, emit, tagQuery) : undefined;
      const res = await callTool(ctx, emit, "group_consensus", { target, purpose, tag_ids: tag ? [tag] : undefined, top: 5 });
      if ((!Array.isArray(res) || !res.length) && tag) await callTool(ctx, emit, "group_consensus", { target, purpose, top: 5 });
    }),
  );
}

async function prepare(ctx: ToolContext, emit: Emit) {
  await Promise.all([
    ctx.members ? null : callTool(ctx, emit, "resolve_group_tastes", {}),
    lookupTag(ctx, emit, TAG_QUERIES.dinner),
    lookupTag(ctx, emit, TAG_QUERIES.activity),
  ]);
}

// ---------------------------------------------------------------------------
// LLM tool-calling loop (OpenAI-compatible /chat/completions)
// Token-frugal: free-tier keys allow ~8k tokens/minute, so the prompt is short,
// tool results are compact, turns are capped and max_tokens is set.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function llmLoop(ctx: ToolContext, emit: Emit, apiKey: string, deadline: number): Promise<Plan> {
  const base = (env("LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = ctx.model!;
  const members = ctx.request.members.map((m) => m.name);
  const likes = (ctx.members ?? []).map((m) => `${m.name}: ${m.tastes.filter((t) => t.entity).map((t) => t.entity!.name).join(", ") || "(nothing matched)"}`);

  // Shortlists with short refs (d1, a2, p3, f1…) instead of long Qloo UUIDs: fewer tokens, fewer copy errors.
  const PREFIX: Record<Slot, string> = { dinner: "d", activity: "a", playlist: "p", film: "f" };
  const refToId = new Map<string, string>();
  const shortlists: Record<string, unknown[]> = {};
  for (const { slot } of SLOT_CALLS) {
    const list = (ctx.slots[slot] ?? []).slice(0, slot === "playlist" ? 6 : 5).map((c, i) => {
      const ref = `${PREFIX[slot]}${i + 1}`;
      refToId.set(ref, c.entity.id);
      const { id: _id, ...rest } = short(c);
      void _id;
      return { ref, ...rest };
    });
    if (list.length) shortlists[slot] = list;
  }
  if (!shortlists.dinner || !shortlists.activity || !shortlists.playlist) throw new Error("not enough scored candidates for the planner");
  const hasFilm = !!shortlists.film;
  emit({ type: "thought", text: `Shortlists scored for ${Object.keys(shortlists).join(", ")}. Handing them to ${model} to choose for consensus and fairness and explain each pick.` });

  const messages: any[] = [
    {
      role: "system",
      content: [
        "You are TasteCircle, an agent planning one night out for friends with different tastes.",
        "You get Qloo-scored shortlists per slot: consensus = fit for the whole group, fairness = least-happy/happiest member, per_member = each friend's affinity %, because = which of their favourites drove it.",
        "Reply with the itinerary JSON only. Use refs from the shortlists (e.g. d2, a1, p3); activity must not be the same venue as dinner; playlist.artist_refs = 4-5 artist refs (p1…).",
        "Choose by consensus AND fairness: avoid a pick a member scores near 0 when a fairer option is close.",
        "Use 'about' for sense-checks: dinner must be somewhere to eat; the activity should be a bar, venue, show or experience, not another restaurant.",
        "whyByMember: one warm, specific sentence per member, second person (you/your), naming THEIR favourites from 'because'; don't start with their name.",
        "blurb: one sentence. Never invent menus, dishes, prices or facts not in the data. title: max 8 words.",
      ].join(" "),
    },
    {
      role: "user",
      content: `City: ${ctx.request.city}.${ctx.request.vibe ? ` Vibe: ${ctx.request.vibe}.` : ""} Members: ${likes.join(" | ")}.\nShortlists: ${JSON.stringify(shortlists)}`,
    },
  ];
  const schema = itinerarySchema(members, hasFilm);
  const isGptOss = /gpt-oss/.test(model);
  let structured = env("LLM_STRUCTURED") !== "0"; // json_schema (strict); falls back to json_object

  for (let step = 0; step < 3; step++) {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const left = deadline - Date.now();
      if (left < 4000) throw new Error("time budget reached");
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.4,
          max_tokens: 1500,
          response_format: structured
            ? { type: "json_schema", json_schema: { name: "itinerary", strict: true, schema } }
            : { type: "json_object" },
          ...(isGptOss ? { reasoning_effort: "low" } : {}),
        }),
        signal: AbortSignal.timeout(left),
      });
      if (res.ok) break;
      if (res.status === 400) {
        const text = await res.clone().text();
        // Provider doesn't support strict json_schema → retry in plain JSON mode.
        if (structured && /json_schema|response_format|not supported/i.test(text) && !/json_validate_failed/.test(text)) {
          structured = false;
          continue;
        }
        break;
      }
      if (res.status !== 429 && res.status < 500) break;
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt;
      if (Date.now() + wait > deadline - 4000) throw new Error(`LLM ${res.status}, retry would exceed time budget`);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res) throw new Error("LLM request failed");
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && /json_validate_failed|tool_use_failed|parse/i.test(text) && step < 2) {
        emit({ type: "thought", text: "The draft didn't match the itinerary schema — asking for a corrected one." });
        messages.push({ role: "user", content: "Your previous reply was not valid JSON for the schema. Reply again with valid JSON only." });
        continue;
      }
      throw new Error(`LLM ${res.status}: ${text.slice(0, 160)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg?.content) throw new Error("LLM returned no content");
    let draft: any;
    try {
      draft = JSON.parse(String(msg.content).replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      messages.push({ role: "assistant", content: String(msg.content).slice(0, 1500) }, { role: "user", content: "That was not valid JSON. Reply with the itinerary JSON only." });
      continue;
    }
    const id = (ref: unknown) => refToId.get(String(ref)) ?? String(ref);
    const stop = (s: any) => (s && s.ref ? { id: id(s.ref), blurb: String(s.blurb ?? ""), whyByMember: s.whyByMember ?? {} } : undefined);
    const args = {
      title: String(draft.title ?? "Tonight"),
      summary: String(draft.summary ?? ""),
      dinner: stop(draft.dinner),
      activity: stop(draft.activity),
      film: stop(draft.film),
      playlist: { artist_ids: (draft.playlist?.artist_refs ?? draft.playlist?.refs ?? []).map(id), blurb: String(draft.playlist?.blurb ?? ""), whyByMember: draft.playlist?.whyByMember ?? {} },
    };
    if (args.dinner && args.activity && args.dinner.id === args.activity.id) {
      messages.push({ role: "assistant", content: String(msg.content).slice(0, 1500) }, { role: "user", content: "dinner and activity must be different venues. Fix it and reply with JSON only." });
      continue;
    }
    const result = (await callTool(ctx, emit, "finalize_itinerary", args as unknown as Record<string, unknown>, `llm-final-${step}`)) as { error?: string };
    if (ctx.plan) return ctx.plan;
    messages.push({ role: "assistant", content: String(msg.content).slice(0, 1500) }, { role: "user", content: `Rejected: ${result?.error ?? "invalid"}. Fix it and reply with JSON only.` });
  }
  throw new Error("agent ran out of steps");
}

/** Strict JSON schema for the itinerary draft (one required key per member). */
function itinerarySchema(members: string[], withFilm: boolean) {
  const why = {
    type: "object",
    properties: Object.fromEntries(members.map((m) => [m, { type: "string" }])),
    required: members,
    additionalProperties: false,
  };
  const stop = {
    type: "object",
    properties: { ref: { type: "string" }, blurb: { type: "string" }, whyByMember: why },
    required: ["ref", "blurb", "whyByMember"],
    additionalProperties: false,
  };
  const properties: Record<string, unknown> = {
    title: { type: "string" },
    summary: { type: "string" },
    dinner: stop,
    activity: stop,
    playlist: {
      type: "object",
      properties: { artist_refs: { type: "array", items: { type: "string" } }, blurb: { type: "string" }, whyByMember: why },
      required: ["artist_refs", "blurb", "whyByMember"],
      additionalProperties: false,
    },
  };
  if (withFilm) properties.film = stop;
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

// ---------------------------------------------------------------------------
// Deterministic planner: same tools, fixed order, templated copy
// ---------------------------------------------------------------------------

async function deterministic(ctx: ToolContext, emit: Emit): Promise<Plan> {
  await prepare(ctx, emit);
  await scoreAllSlots(ctx, emit);

  // Reuses any group_consensus results the LLM already fetched (ctx.slots), so a
  // fallback never repeats Qloo work.
  const pick = async (slot: Slot, target: string, purpose: string, tagQuery?: string) => {
    const cached = ctx.slots[slot]?.filter((c) => !ctx.used.has(c.entity.id));
    if (cached?.length) return cached.slice(0, 6).map(short);
    const tag = tagQuery ? await lookupTag(ctx, emit, tagQuery) : undefined;
    let res = (await callTool(ctx, emit, "group_consensus", { target, purpose, tag_ids: tag ? [tag] : undefined, top: 6 })) as any[];
    if ((!Array.isArray(res) || !res.length) && tag) res = (await callTool(ctx, emit, "group_consensus", { target, purpose, top: 6 })) as any[];
    return Array.isArray(res) ? res : [];
  };
  const fairest = (list: any[], purpose: string) => {
    const best = [...list].sort((a, b) => b.consensus + 0.3 * b.fairness - (a.consensus + 0.3 * a.fairness))[0];
    const top = list[0];
    if (best && top && best.id !== top.id)
      emit({
        type: "thought",
        text: `For ${purpose}, ${best.name} beats ${top.name}: nearly the same consensus (${best.consensus}% vs ${top.consensus}%) but fairer (${best.fairness}% vs ${top.fairness}%).`,
      });
    return best;
  };

  const dinner = fairest(await pick("dinner", "place", "dinner", TAG_QUERIES.dinner), "dinner");
  if (!dinner) throw new Error("Couldn't find dinner options for this group in that city.");
  ctx.used.add(dinner.id);
  const activity = fairest(await pick("activity", "place", "after-dinner activity", TAG_QUERIES.activity), "the after-dinner plan");
  if (!activity) throw new Error("Couldn't find an activity for this group in that city.");
  ctx.used.add(activity.id);
  const artists = (await pick("playlist", "artist", "shared playlist")).slice(0, 5);
  const films = await pick("film", "movie", "next movie night");

  const c = (id: string) => ctx.candidates.get(id) as Candidate;
  const whyAll = (cand: Candidate) => Object.fromEntries(ctx.request.members.map((m) => [m.name, defaultWhy(m.name, cand)]));
  const playlistWhy = Object.fromEntries(
    ctx.request.members.map((m) => {
      const mine = artists.map((a) => c(a.id)).sort((x, y) => (y.memberAffinity[m.name] ?? 0) - (x.memberAffinity[m.name] ?? 0))[0];
      return [m.name, mine ? `Listen for ${mine.entity.name} — ${defaultWhy(m.name, mine).replace(/^./, (s) => s.toLowerCase())}` : ""];
    }),
  );
  const names = ctx.request.members.map((m) => m.name);
  const args: FinalizeArgs = {
    title: `${c(dinner.id).entity.name} → ${c(activity.id).entity.name}`,
    summary: `Every pick tonight was scored against all ${names.length} of your tastes, and the fairest high-consensus option won. ${listify(names)} each get something that's genuinely theirs.`,
    dinner: { id: dinner.id, blurb: pitch(c(dinner.id)), whyByMember: whyAll(c(dinner.id)) },
    activity: { id: activity.id, blurb: pitch(c(activity.id)), whyByMember: whyAll(c(activity.id)) },
    playlist: {
      artist_ids: artists.map((a) => a.id),
      blurb: `A ${artists.length}-artist mix where everyone's taste overlaps — queue it on the way between stops.`,
      whyByMember: playlistWhy,
    },
    film: films[0] ? { id: films[0].id, blurb: pitch(c(films[0].id)), whyByMember: whyAll(c(films[0].id)) } : undefined,
  };
  await callTool(ctx, emit, "finalize_itinerary", args as unknown as Record<string, unknown>);
  if (!ctx.plan) throw new Error("Could not assemble the itinerary.");
  return ctx.plan;
}

function pitch(c: Candidate): string {
  const tags = (c.entity.tags ?? []).slice(0, 3);
  if (c.entity.kind === "movie") {
    const vibe = tags.length ? `${listify(tags).replace(/^./, (s) => s.toUpperCase())} — ` : "";
    return `${vibe}${Math.round(c.consensus * 100)}% group consensus. Save it for the next movie night.`;
  }
  const what = c.entity.subtitle ? c.entity.subtitle.toLowerCase() : "spot";
  const article = /^[aeiou]/i.test(what) ? "An" : "A";
  return `${article} ${what}${tags.length ? ` with ${listify(tags)} energy` : ""} — ${Math.round(c.consensus * 100)}% group consensus.`;
}
