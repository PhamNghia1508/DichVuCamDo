// Exercises the LLM tool-calling loop against a scripted fake
// OpenAI-compatible endpoint (no network, no keys), in MOCK Qloo mode.
//  1. happy path: slots scored in parallel, one forced finalize_itinerary turn
//  2. fallback: the LLM dies after scoring; the deterministic finisher must
//     reuse those scores instead of repeating the Qloo work
import { runAgent, validateRequest } from "../lib/agent/run";
import { mockClient } from "../lib/qloo";
import type { AgentEvent } from "../lib/types";

process.env.LLM_API_KEY = "test";
process.env.LLM_BASE_URL = "http://fake-llm.local/v1";
process.env.LLM_MODEL = "fake-model";

let turn = 0;
let failAfterScoring = false;
const picks: Record<string, string[]> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (!String(url).startsWith("http://fake-llm.local")) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  if (!body.max_tokens) throw new Error("max_tokens must be set");
  const user = body.messages.find((m: { role: string }) => m.role === "user").content as string;
  const lists = JSON.parse(user.slice(user.indexOf("Shortlists: ") + 12)) as Record<string, { ref: string; name: string }[]>;
  for (const [k, v] of Object.entries(lists)) picks[k] = v.map((x) => x.ref);
  turn++;
  if (failAfterScoring) return new Response("boom", { status: 401 });
  if (body.response_format?.type !== "json_schema") throw new Error("structured output expected");
  const draft = {
    title: "Test night",
    summary: "A test.",
    dinner: { ref: picks.dinner[0], blurb: "d", whyByMember: { A: "a" } },
    activity: { ref: lists.activity.find((x) => x.name !== lists.dinner[0].name)!.ref, blurb: "a", whyByMember: {} },
    playlist: { artist_refs: picks.playlist.slice(0, 3), blurb: "p", whyByMember: {} },
  };
  const out = { choices: [{ message: { role: "assistant", content: JSON.stringify(draft) } }] };
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const req = () =>
  validateRequest({
    city: "Lisbon",
    members: [
      { name: "A", tastes: { artist: ["Radiohead"], movie: ["Dune"], place: [], book: [] } },
      { name: "B", tastes: { artist: ["SZA"], movie: ["Barbie"], place: ["sushi"], book: [] } },
    ],
  });

(async () => {
  const log = (e: AgentEvent) => e.type === "tool_end" && console.log(`  ${e.ok ? "✓" : "✗"} ${e.tool}: ${e.summary}`);
  const plan = await runAgent(req(), log, mockClient);
  if (plan.mode.planner !== "llm" || plan.title !== "Test night" || plan.stops.length !== 3 || turn !== 1) {
    console.error("FAIL", plan.mode, plan.title, "turns", turn);
    process.exit(1);
  }
  if (!plan.stops[1].whyByMember.A) throw new Error("missing default why fill");
  console.log("LLM LOOP OK");

  turn = 0;
  failAfterScoring = true;
  let consensusCalls = 0;
  const plan2 = await runAgent(req(), (e) => {
    log(e);
    if (e.type === "tool_start" && e.tool === "group_consensus") consensusCalls++;
  }, mockClient);
  // 4 slots scored once before the LLM; the fallback must not score again
  if (plan2.mode.planner !== "deterministic" || consensusCalls !== 4 || plan2.stops.length < 3) {
    console.error("FAIL fallback", plan2.mode, "consensus calls", consensusCalls);
    process.exit(1);
  }
  console.log("LLM FALLBACK REUSE OK");
})();
