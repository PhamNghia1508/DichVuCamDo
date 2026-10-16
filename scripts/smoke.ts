// Smoke test: full agent in MOCK mode (no keys) — plan, critic/bridge, refinement, baseline.
import { runAgent, refineAgent, validateRequest, parseChange } from "../lib/agent/run";
import { runBaseline } from "../lib/agent/baseline";
import { placeCheck } from "../lib/agent/slots";
import { makeMockClient } from "../lib/qloo";
import type { AgentEvent, Entity } from "../lib/types";

const assert = (c: unknown, m: string) => {
  if (!c) {
    console.error("FAIL:", m);
    process.exit(1);
  }
};

async function main() {
  delete process.env.LLM_API_KEY;
  const req = validateRequest({
    city: "Ho Chi Minh City",
    members: [
      { name: "Gô", tastes: { artist: ["Radiohead", "Đen Vâu"], movie: ["Interstellar", "Breaking Bad"], place: ["ramen"], book: ["Norwegian Wood", "Serial"] } },
      { name: "Chi", tastes: { artist: ["Taylor Swift"], movie: ["La La Land"], place: ["pizza"], book: [] } },
      { name: "Minh", tastes: { artist: ["Kendrick Lamar", "Daft Punk"], movie: ["Spirited Away"], place: ["tacos"], book: [] } },
    ],
  });
  const events: AgentEvent[] = [];
  const log = (e: AgentEvent) => {
    events.push(e);
    if (e.type === "tool_end") console.log(`  ${e.ok ? "✓" : "✗"} ${e.tool}: ${e.summary}`);
    if (e.type === "critique") console.log(`  ⚑ ${e.text}`);
  };
  const plan = await runAgent(req, log, makeMockClient());
  assert(plan.stops.length >= 3, "has 3+ stops");
  assert(plan.stops[0].entity && plan.stops[1].entity && plan.stops[0].entity.id !== plan.stops[1].entity.id, "dinner != activity");
  assert((plan.stops.find((s) => s.slot === "playlist")?.entities ?? []).length >= 3, "playlist has 3+ artists");
  for (const s of plan.stops) for (const m of plan.members) assert(s.whyByMember[m], `why for ${m} at ${s.slot}`);
  assert(plan.tasteMap && plan.tasteMap.members.length === 3, "taste map for every member");
  assert(plan.circle?.length === 3 && plan.ranges?.dinner, "plan carries circle + fit ranges for refinement");
  assert(events.some((e) => e.type === "taste_map"), "taste_map event streamed");
  // cross-domain: TV show + podcast resolved
  assert(plan.circle!.some((m) => m.likes.some((l) => l.kind === "tv_show")) && plan.circle!.some((m) => m.likes.some((l) => l.kind === "podcast")), "tv_show + podcast inputs resolved");
  // drivers only credit the member's own favourites
  for (const s of plan.stops)
    for (const [m, ds] of Object.entries(s.drivers ?? {})) {
      const mine = new Set(plan.circle!.find((c) => c.name === m)!.likes.map((l) => l.name));
      if (s.slot !== "playlist") for (const d of ds) assert(mine.has(d.name), `${s.slot}: driver ${d.name} belongs to ${m}`);
    }
  console.log("PLAN OK —", plan.title, "·", plan.stats);

  // refinement: deterministic parser + re-query
  const pc = parseChange("Minh is vegetarian and make it cheaper", plan.members);
  assert(pc.constraints.dietary?.[0] === "vegetarian" && pc.constraints.dietaryFor?.[0] === "Minh" && pc.constraints.priceMax === 2, "parseChange");
  assert(parseChange("move it to Saigon", plan.members).city === "Ho Chi Minh City", "parseChange city alias");
  const quieter = await refineAgent(plan, "swap the bar for something quieter", log, makeMockClient());
  const act = quieter.stops.find((s) => s.slot === "activity")!;
  assert(act.entity?.facets?.noise !== "Loud", "quieter activity is not tagged loud");
  assert(quieter.stops.find((s) => s.slot === "dinner")!.entity!.id === plan.stops[0].entity!.id, "dinner kept on activity-only change");
  assert(quieter.changes?.length === 1, "change note recorded");
  const moved = await refineAgent(quieter, "move it to Tokyo", log, makeMockClient());
  assert(moved.city === "Tokyo", "city moved");
  console.log("REFINE OK —", act.entity?.name, "→", moved.city);

  // baseline audit
  const base = await runBaseline(plan, makeMockClient());
  assert(base.picks.length >= 3, "baseline picks");
  console.log("BASELINE OK —", base.picks.map((p) => `${p.slot}:${p.name}${p.unverified ? "(unverified)" : ` ${Math.round((p.consensus ?? 0) * 100)}%`}`).join(" | "));

  // category validation
  const e = (cats: string[]): Entity => ({ id: "x", name: "x", kind: "place", facets: { categories: cats } });
  assert(placeCheck("dinner", e(["Department store", "Restaurant"])), "department store rejected for dinner");
  assert(placeCheck("activity", e(["Wedding venue", "Bar"])), "wedding venue rejected for activity");
  assert(!placeCheck("activity", e(["Cocktail bar"])), "cocktail bar ok for activity");
  assert(placeCheck("activity", e(["Italian restaurant"])), "plain restaurant rejected for activity");
  assert(!placeCheck("dinner", e(["Ramen restaurant"])), "ramen ok for dinner");
  const named = (name: string, cats: string[]): Entity => ({ id: "y", name, kind: "place", facets: { categories: cats } });
  assert(placeCheck("dinner", named("International Cafeteria, Tokyo International University", ["Restaurant"])), "university cafeteria rejected");
  assert(placeCheck("dinner", named("Staff Canteen", ["Cafeteria"])), "cafeteria rejected for dinner");
  assert(!placeCheck("dinner", named("Ben Nghe Street Food", ["Cafeteria", "Night market", "Brewpub"])), "street-food market ok");
  assert(placeCheck("activity", named("Grand Lobby", ["Hotel", "Restaurant"])), "hotel lobby rejected for activity");
  assert(!placeCheck("activity", named("Hotel bar", ["Hotel", "Cocktail bar"])), "hotel cocktail bar ok");
  assert(placeCheck("dinner", named("The British Library", ["Cafe", "Library"])), "library rejected");
  console.log("\nSMOKE OK");
}
main();
