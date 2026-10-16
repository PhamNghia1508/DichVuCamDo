// GET /api/health — reports which modes are active (never the keys themselves).
export const dynamic = "force-dynamic";

export function GET() {
  const qloo = process.env.QLOO_API_KEY && !process.env.TASTECIRCLE_FORCE_MOCK ? "live" : "mock";
  const planner = process.env.LLM_API_KEY ? "llm" : "deterministic";
  return Response.json({
    ok: true,
    qloo,
    planner,
    model: planner === "llm" ? process.env.LLM_MODEL || "gpt-4.1-mini" : null,
    agent: { tools: ["search_slot", "find_bridge", "set_city", "finalize_itinerary"], critic: true, refine: true, baseline: true },
    version: "3.0.0",
  });
}
