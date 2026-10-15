// POST /api/plan — runs the TasteCircle agent and streams its progress as
// newline-delimited JSON (AgentEvent per line). Keys stay on the server.
import { runAgent, validateRequest } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let request;
  try {
    request = validateRequest(body);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const plan = await runAgent(request, emit);
        emit({ type: "plan", plan });
      } catch (err) {
        emit({ type: "error", message: (err as Error).message || "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
