// Exercises the LLM tool-calling agent against a scripted fake OpenAI-compatible
// endpoint (no network, no keys), in MOCK Qloo mode:
//  1. happy path: Phase A scores every slot, the model finalizes with refs
//  2. critic: the model picks the least fair option → the critic rejects it,
//     the model calls find_bridge, then finalizes again
//  3. refinement: "somewhere quieter" → search_slot(activity, quiet) → keep the rest
//  4. fallback: the LLM dies → deterministic finisher reuses Phase A scores
import { leftOut, refineAgent, runAgent, validateRequest } from "../lib/agent/run";
import { bridgeSearch, harmonicMean } from "../lib/agent/consensus";
import { makeMockClient } from "../lib/qloo";
import type { AgentEvent } from "../lib/types";

process.env.LLM_API_KEY = "test";
process.env.LLM_BASE_URL = "http://fake-llm.local/v1";
process.env.LLM_MODEL = "fake-model";

type Msg = { role: string; content: string | null; tool_calls?: unknown[] };
type Script = (body: { messages: Msg[]; tools: { function: { name: string } }[]; tool_choice: unknown }, turn: number) => unknown;
let script: Script = () => ({ content: "hi" });
let turn = 0;
let fail = false;
let writerCalls = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (!String(url).startsWith("http://fake-llm.local")) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  if (!body.max_tokens && !body.max_completion_tokens) throw new Error("max tokens must be set");
  if (fail) return new Response("boom", { status: 401 });
  if (body.response_format?.json_schema?.name === "copy") {
    // writer pass: rewrite every reason, but name the credited favourite for only one friend
    writerCalls++;
    const schema = body.response_format.json_schema.schema;
    const stops = Object.fromEntries(Object.keys(schema.properties.stops.properties).map((k) => [k, { blurb: `new ${k}`, why: { A: "Generic line with no favourite.", B: "Generic.", C: "Generic." } }]));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ title: "Polished", summary: "Polished summary.", stops }) } }] }), { status: 200 });
  }
  const msg = script(body, turn++);
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...(msg as object) } }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const call = (name: string, args: unknown, id = `c${Math.random().toString(36).slice(2, 7)}`) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const shortlists = (messages: Msg[]) => {
  const u = messages.find((m) => m.role === "user")!.content!;
  return JSON.parse(u.slice(u.indexOf("Shortlists: ") + 12)) as Record<string, { ref: string; name: string; fairness: number; fit: Record<string, number> }[]>;
};
const why = (names: string[]) => Object.fromEntries(names.map((n) => [n, `because ${n}`]));
const fail_ = (m: string) => {
  console.error("FAIL:", m);
  process.exit(1);
};

const req = () =>
  validateRequest({
    city: "Lisbon",
    members: [
      { name: "A", tastes: { artist: ["Radiohead", "Bon Iver"], movie: ["Arrival"], place: [], book: ["Norwegian Wood"] } },
      { name: "B", tastes: { artist: ["Bad Bunny"], movie: ["Barbie"], place: ["tacos"], book: [] } },
      { name: "C", tastes: { artist: ["Norah Jones"], movie: ["La La Land"], place: ["sushi"], book: [] } },
    ],
  });

(async () => {
  const events: AgentEvent[] = [];
  const log = (e: AgentEvent) => {
    events.push(e);
    if (e.type === "tool_end") console.log(`  ${e.ok ? "✓" : "✗"} ${e.tool}: ${e.summary}`);
    if (e.type === "critique") console.log(`  ⚑ ${e.text}`);
  };
  const names = ["A", "B", "C"];

  // 1. happy path
  script = (body) => {
    if (!body.tools.some((t) => t.function.name === "find_bridge")) fail_("find_bridge tool missing");
    const L = shortlists(body.messages);
    const fairest = (k: string) => [...L[k]].sort((x, y) => y.fairness - x.fairness)[0].ref;
    return {
      content: "Picking the fairest options.",
      tool_calls: [
        call("finalize_itinerary", {
          title: "Test night",
          summary: "A test.",
          dinner: { ref: fairest("dinner"), blurb: "d", why: why(names) },
          activity: { ref: fairest("activity"), blurb: "a", why: why(names) },
          film: { ref: L.film[0].ref, blurb: "f", why: why(names) },
          playlist: { refs: L.playlist.slice(0, 4).map((x) => x.ref), blurb: "p", why: why(names) },
        }),
      ],
    };
  };
  turn = 0;
  const plan = await runAgent(req(), log, makeMockClient());
  if (plan.mode.planner !== "llm" || plan.title !== "Polished" || plan.stops.length !== 4) fail_(`happy path: ${JSON.stringify(plan.mode)} ${plan.title}`);
  if (writerCalls !== 1) fail_("writer pass should run once");
  // ungrounded reasons (no credited favourite named) must be rejected, keeping the agent's draft
  for (const s of plan.stops) for (const m of names) if ((s.drivers?.[m]?.length ?? 0) > 0 && /^Generic/.test(s.whyByMember[m])) fail_(`ungrounded writer line kept for ${m} at ${s.slot}`);
  if (!events.some((e) => e.type === "thought" && e.text === "Picking the fairest options.")) fail_("model reasoning not streamed");
  console.log("LLM PLAN OK");

  // 2. critic → bridge → finalize
  let sawCritic = false;
  let bridged = false;
  script = (body, t) => {
    const last = body.messages[body.messages.length - 1];
    const L = shortlists(body.messages);
    const unfair = [...L.activity].sort((x, y) => x.fairness - y.fairness)[0];
    const lowMember = Object.entries(unfair.fit).sort((a, b) => a[1] - b[1])[0][0];
    const fin = (activityRef: string) =>
      call("finalize_itinerary", {
        title: "Critic night",
        summary: "s",
        dinner: { ref: L.dinner[0].ref, blurb: "d", why: why(names) },
        activity: { ref: activityRef, blurb: "a", why: why(names) },
        playlist: { refs: L.playlist.slice(0, 4).map((x) => x.ref), blurb: "p", why: why(names) },
      });
    if (t === 0) return { content: null, tool_calls: [fin(unfair.ref)] };
    if (last.role === "tool" && /Critic rejected/.test(String(last.content))) {
      sawCritic = true;
      return { content: `Bridging for ${lowMember}.`, tool_calls: [call("find_bridge", { slot: "activity", member: lowMember })] };
    }
    if (last.role === "tool" && /bridges|skipped/.test(String(last.content))) {
      bridged = true;
      const r = JSON.parse(String(last.content));
      return { content: null, tool_calls: [fin(r.bridges?.[0]?.ref ?? L.activity[0].ref)] };
    }
    return { content: null, tool_calls: [fin(L.activity[0].ref)] };
  };
  turn = 0;
  events.length = 0;
  const p2 = await runAgent(req(), log, makeMockClient());
  const criticFired = events.some((e) => e.type === "critique");
  if (criticFired && !(sawCritic && bridged)) fail_("critic fired but the model never got to bridge");
  if (p2.title !== "Polished") fail_("critic path did not finish with the model's plan");
  console.log(criticFired ? "CRITIC → BRIDGE OK" : "CRITIC OK (mock data left nobody out; nothing to reject)");

  // critic rule + bridge search, deterministically
  const cand = (fits: Record<string, number>) => {
    const v = Object.values(fits);
    return { entity: { id: "x", name: "X", kind: "place" as const }, groupAffinity: 0.9, memberRaw: {}, memberAffinity: fits, consensus: 0.5, fairness: Math.min(...v) / Math.max(...v), drivers: {}, lean: {} };
  };
  if (leftOut(cand({ A: 0.9, B: 0.85, C: 0.1 }))?.member !== "C") fail_("critic should flag C at 10%");
  if (leftOut(cand({ A: 0.7, B: 0.6, C: 0.5 }))) fail_("critic should pass a fair pick");
  if (harmonicMean([0.9, 0.9, 0.05]) > 0.15) fail_("harmonic mean must punish one low member");
  const mock = makeMockClient();
  const resolved = await Promise.all(req().members.map(async (m) => ({ name: m.name, tastes: await Promise.all(m.tastes.artist.map(async (a) => ({ input: a, kind: "artist" as const, entity: await mock.search(a, "artist") }))) })));
  const bridges = await bridgeSearch(mock, resolved, "activity", "B", undefined, { city: "Lisbon" });
  if (!bridges.length || bridges.some((b) => b.bridgeFor !== "B")) fail_("bridge search seeded from B");
  console.log("CRITIC RULE + BRIDGE SEARCH OK");

  // 3. refinement via tools
  script = (body, t) => {
    if (!body.tools.some((x) => x.function.name === "set_city")) fail_("set_city missing in refine mode");
    const last = body.messages[body.messages.length - 1];
    if (t === 0) return { content: "Looking for a calmer room.", tool_calls: [call("search_slot", { slot: "activity", quiet: true })] };
    const r = JSON.parse(String(last.content));
    return {
      content: null,
      tool_calls: [
        call("finalize_itinerary", {
          title: "Quieter night",
          summary: "s",
          change_note: "Swapped the activity for a quieter room.",
          dinner: { ref: "keep", blurb: "", why: {} },
          activity: { ref: r.shortlist[0].ref, blurb: "calm", why: why(names) },
          playlist: { refs: ["keep"], blurb: "", why: {} },
        }),
      ],
    };
  };
  turn = 0;
  const p3 = await refineAgent(plan, "somewhere quieter after dinner", log, makeMockClient());
  if (p3.stops.find((s) => s.slot === "dinner")!.entity!.id !== plan.stops.find((s) => s.slot === "dinner")!.entity!.id) fail_("dinner should be kept");
  if (p3.stops.find((s) => s.slot === "activity")!.entity!.facets?.noise === "Loud") fail_("quiet constraint ignored");
  if (!p3.stops.some((s) => s.slot === "playlist") || !p3.stops.some((s) => s.slot === "film")) fail_("kept stops dropped");
  if (p3.changes?.[0] !== "Swapped the activity for a quieter room.") fail_("change note missing");
  console.log("LLM REFINE OK");

  // 4. fallback reuses Phase A
  fail = true;
  let pools = 0;
  const p4 = await runAgent(req(), (e) => {
    log(e);
    if (e.type === "tool_start" && e.tool === "candidate_pool") pools++;
  }, makeMockClient());
  if (p4.mode.planner !== "deterministic" || p4.stops.length < 3) fail_("fallback plan");
  // 4 slots scored once; only a bridge search may add pools
  if (pools > 4 + 3) fail_(`fallback repeated Qloo work (${pools} pools)`);
  console.log("LLM FALLBACK REUSE OK");
})();
