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
import { TOOLS, defaultWhy, listify, type FinalizeArgs, type ToolContext } from "./tools";

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

export async function runAgent(request: PlanRequest, emit: Emit, qloo: QlooClient = getQloo()): Promise<Plan> {
  const llmKey = env("LLM_API_KEY");
  const ctx: ToolContext = {
    qloo,
    request,
    members: null,
    candidates: new Map(),
    used: new Set(),
    plan: null,
    planner: llmKey ? "llm" : "deterministic",
    model: llmKey ? env("LLM_MODEL") || "gpt-4o-mini" : undefined,
  };
  emit({
    type: "status",
    message: `Qloo: ${qloo.mode === "live" ? "live API" : "mock data"} · Planner: ${llmKey ? ctx.model : "deterministic"}`,
  });

  if (llmKey) {
    try {
      return await llmLoop(ctx, emit, llmKey);
    } catch (err) {
      emit({ type: "thought", text: `LLM planner failed (${(err as Error).message}); finishing with the deterministic planner.` });
      ctx.planner = "deterministic";
      ctx.model = undefined;
    }
  }
  return deterministic(ctx, emit);
}

async function callTool(ctx: ToolContext, emit: Emit, name: string, args: Record<string, unknown>, id: string) {
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

// ---------------------------------------------------------------------------
// LLM tool-calling loop (OpenAI-compatible /chat/completions)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function llmLoop(ctx: ToolContext, emit: Emit, apiKey: string): Promise<Plan> {
  const base = (env("LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = ctx.model!;
  const members = ctx.request.members.map((m) => m.name);
  const messages: any[] = [
    {
      role: "system",
      content: [
        "You are TasteCircle, an agent that plans one great night out for a group of friends with different tastes.",
        "Use the tools. Required flow: resolve_group_tastes → find_tags (restaurant, and a nightlife/bar/music/venue keyword) →",
        "group_consensus for dinner (place + restaurant tag), activity (place + nightlife/venue tag; must differ from dinner),",
        "playlist (artist), and optionally film (movie) → finalize_itinerary.",
        "Pick by consensus AND fairness: never pick something one member scores near 0 if a fairer option is close.",
        "If a tag search returns nothing useful, call group_consensus without tag_ids.",
        "whyByMember: one warm, specific sentence per member that names THEIR favourites from the 'because' data. No generic filler.",
        `Members: ${members.join(", ")}. City: ${ctx.request.city}.${ctx.request.vibe ? ` Requested vibe: ${ctx.request.vibe}.` : ""}`,
      ].join(" "),
    },
    { role: "user", content: "Plan our night: dinner, then an activity, then a shared playlist." },
  ];
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

  for (let step = 0; step < 12; step++) {
    let res: Response | undefined;
    // Free-tier LLM keys are rate-limited: retry 429/5xx a few times with backoff.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.4 }),
      });
      if (res.ok) break;
      // Groq returns 400 tool_use_failed when the model emits malformed tool JSON; a retry usually fixes it.
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 400 && (await res.clone().text()).includes("tool_use_failed"));
      if (!retryable) break;
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 12) * 1000 : 1500 * 2 ** attempt));
    }
    if (!res) throw new Error("LLM request failed");
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("LLM returned no message");
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    if (msg.content && String(msg.content).trim()) emit({ type: "thought", text: String(msg.content).trim().slice(0, 400) });
    const calls: any[] = msg.tool_calls ?? [];
    if (!calls.length) {
      messages.push({ role: "user", content: "Continue with the tools until you have called finalize_itinerary." });
      continue;
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        /* keep empty */
      }
      const result = await callTool(ctx, emit, call.function?.name, args, call.id || `${step}-${call.function?.name}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
    if (ctx.plan) return ctx.plan;
  }
  throw new Error("agent ran out of steps");
}

// ---------------------------------------------------------------------------
// Deterministic planner: same tools, fixed order, templated copy
// ---------------------------------------------------------------------------

async function deterministic(ctx: ToolContext, emit: Emit): Promise<Plan> {
  let n = 0;
  const call = (name: string, args: Record<string, unknown> = {}) => callTool(ctx, emit, name, args, `d${n++}`);

  if (!ctx.members) await call("resolve_group_tastes");

  const tagId = async (query: string) => {
    const tags = (await call("find_tags", { query })) as { id: string; type?: string }[] | { error: string };
    if (!Array.isArray(tags)) return undefined;
    return tags.find((t) => /place/.test(t.type ?? t.id))?.id ?? tags[0]?.id;
  };
  const restaurantTag = await tagId("restaurant");
  const nightTag = await tagId("bar music venue nightlife");

  const pick = async (target: string, purpose: string, tag?: string) => {
    let res = (await call("group_consensus", { target, purpose, tag_ids: tag ? [tag] : undefined, top: 6 })) as any[];
    if (!Array.isArray(res) || !res.length) res = (await call("group_consensus", { target, purpose, top: 6 })) as any[];
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

  const dinner = fairest(await pick("place", "dinner", restaurantTag), "dinner");
  if (!dinner) throw new Error("Couldn't find dinner options for this group in that city.");
  ctx.used.add(dinner.id);
  const activity = fairest(await pick("place", "after-dinner activity", nightTag), "the after-dinner plan");
  if (!activity) throw new Error("Couldn't find an activity for this group in that city.");
  ctx.used.add(activity.id);
  const artists = (await pick("artist", "shared playlist")).slice(0, 5);
  const films = await pick("movie", "next movie night");

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
  await call("finalize_itinerary", args as unknown as Record<string, unknown>);
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
