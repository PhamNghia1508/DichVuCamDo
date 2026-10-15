// Exercises the LLM tool-calling loop against a scripted fake
// OpenAI-compatible endpoint (no network, no keys), in MOCK Qloo mode.
import { runAgent, validateRequest } from "../lib/agent/run";
import { mockClient } from "../lib/qloo";

process.env.LLM_API_KEY = "test";
process.env.LLM_BASE_URL = "http://fake-llm.local/v1";
process.env.LLM_MODEL = "fake-model";

let turn = 0;
const picks: Record<string, string[]> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  if (!String(url).startsWith("http://fake-llm.local")) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  const last = body.messages[body.messages.length - 1];
  if (last.role === "tool") {
    try {
      const r = JSON.parse(last.content);
      if (Array.isArray(r) && r[0]?.consensus !== undefined) picks[`t${turn}`] = r.map((x: { id: string }) => x.id);
    } catch {}
  }
  const call = (name: string, args: object) => ({
    choices: [{ message: { role: "assistant", content: turn === 1 ? "Resolving tastes first." : "", tool_calls: [{ id: `c${turn}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
  });
  turn++;
  const steps = [
    () => call("resolve_group_tastes", {}),
    () => call("group_consensus", { target: "place", purpose: "dinner", tag_ids: ["mock:tag:place:restaurant"] }),
    () => call("group_consensus", { target: "place", purpose: "activity", tag_ids: ["mock:tag:place:activity"] }),
    () => call("group_consensus", { target: "artist", purpose: "playlist" }),
    () => call("finalize_itinerary", {
      title: "Test night",
      summary: "A test.",
      dinner: { id: picks.t2[0], blurb: "d", whyByMember: { A: "a" } },
      activity: { id: picks.t3[0], blurb: "a", whyByMember: {} },
      playlist: { artist_ids: picks.t4.slice(0, 3), blurb: "p", whyByMember: {} },
    }),
  ];
  return new Response(JSON.stringify(steps[turn - 1]()), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

(async () => {
  const req = validateRequest({
    city: "Lisbon",
    members: [
      { name: "A", tastes: { artist: ["Radiohead"], movie: ["Dune"], place: [], book: [] } },
      { name: "B", tastes: { artist: ["SZA"], movie: ["Barbie"], place: ["sushi"], book: [] } },
    ],
  });
  const plan = await runAgent(req, (e) => e.type === "tool_end" && console.log(`  ${e.ok ? "✓" : "✗"} ${e.tool}: ${e.summary}`), mockClient);
  if (plan.mode.planner !== "llm" || plan.title !== "Test night" || plan.stops.length !== 3) {
    console.error("FAIL", plan.mode, plan.title);
    process.exit(1);
  }
  if (!plan.stops[1].whyByMember.A) throw new Error("missing default why fill");
  console.log("LLM LOOP OK");
})();
