// Smoke test: runs the full agent in MOCK mode (no keys needed) and checks the plan.
import { runAgent, validateRequest } from "../lib/agent/run";
import { mockClient } from "../lib/qloo";

async function main() {
  delete process.env.LLM_API_KEY;
  const req = validateRequest({
    city: "Ho Chi Minh City",
    members: [
      { name: "Gô", tastes: { artist: ["Radiohead", "Đen Vâu"], movie: ["Interstellar"], place: ["ramen"], book: ["Norwegian Wood"] } },
      { name: "Chi", tastes: { artist: ["Taylor Swift"], movie: ["La La Land"], place: ["pizza"], book: [] } },
      { name: "Minh", tastes: { artist: ["Kendrick Lamar", "Daft Punk"], movie: ["Spirited Away"], place: ["tacos"], book: [] } },
    ],
  });
  const plan = await runAgent(req, (e) => {
    if (e.type === "tool_end") console.log(`  ${e.ok ? "✓" : "✗"} ${e.tool}: ${e.summary}`);
  }, mockClient);
  const assert = (c: unknown, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
  assert(plan.stops.length >= 3, "has 3+ stops");
  assert(plan.stops[0].entity && plan.stops[1].entity && plan.stops[0].entity.id !== plan.stops[1].entity.id, "dinner != activity");
  assert((plan.stops[2].entities ?? []).length >= 3, "playlist has 3+ artists");
  for (const s of plan.stops) for (const m of plan.members) assert(s.whyByMember[m], `why for ${m} at ${s.slot}`);
  console.log(JSON.stringify(plan, null, 2).slice(0, 2500));
  console.log("\nSMOKE OK");
}
main();
