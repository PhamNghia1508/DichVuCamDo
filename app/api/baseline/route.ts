// POST /api/baseline — { plan } → what the same LLM suggests WITHOUT Qloo, audited
// and scored with Qloo on the same per-member scale as the plan.
import { runBaseline } from "@/lib/agent/baseline";
import type { Plan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { plan?: Plan };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.plan?.circle?.length) return Response.json({ error: "plan is required" }, { status: 400 });
  try {
    return Response.json(await runBaseline(body.plan));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
