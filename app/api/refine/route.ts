// POST /api/refine — { plan, message } → streams AgentEvents (NDJSON) while the
// agent re-queries Qloo for the stops that must change, then the new plan.
import { refineAgent } from "@/lib/agent/run";
import type { AgentEvent, Plan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { plan?: Plan; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = String(body.message ?? "").trim().slice(0, 400);
  if (!body.plan || !message) return Response.json({ error: "plan and message are required" }, { status: 400 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        emit({ type: "plan", plan: await refineAgent(body.plan!, message, emit) });
      } catch (err) {
        emit({ type: "error", message: (err as Error).message || "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
