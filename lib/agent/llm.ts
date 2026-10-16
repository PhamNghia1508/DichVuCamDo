// Minimal OpenAI-compatible chat-completions client with tool calling,
// retries on 429/5xx and a hard deadline. No SDK, so it also runs in the browser
// bundle for the static demo (where it is simply never called).

/* eslint-disable @typescript-eslint/no-explicit-any */
const env = (k: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[k] : undefined;

export interface LlmConfig {
  apiKey: string;
  base: string;
  model: string;
}

export function llmConfig(): LlmConfig | null {
  const apiKey = env("LLM_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    base: (env("LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env("LLM_MODEL") || "gpt-4.1-mini",
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export async function chat(
  cfg: LlmConfig,
  body: {
    messages: ChatMessage[];
    tools?: ToolDef[];
    tool_choice?: unknown;
    response_format?: unknown;
    max_tokens?: number;
    temperature?: number;
    model?: string;
  },
  deadline: number,
): Promise<ChatMessage> {
  const model = body.model ?? cfg.model;
  const reasoning = /^(gpt-5|o\d)/.test(model);
  const payload: Record<string, unknown> = {
    model,
    messages: body.messages,
    ...(body.tools ? { tools: body.tools, tool_choice: body.tool_choice ?? "auto" } : {}),
    ...(body.response_format ? { response_format: body.response_format } : {}),
    ...(reasoning
      ? { max_completion_tokens: body.max_tokens ?? 1500, reasoning_effort: "low" }
      : { max_tokens: body.max_tokens ?? 1500, temperature: body.temperature ?? 0.5 }),
    ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left < 2500) throw new Error("LLM time budget reached");
    let res: Response;
    try {
      res = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.min(left, 40_000)),
      });
    } catch (err) {
      lastErr = (err as Error).message;
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("LLM returned no message");
      return { role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) };
    }
    const text = await res.text().catch(() => "");
    lastErr = `LLM ${res.status}: ${text.slice(0, 160)}`;
    if (res.status !== 429 && res.status < 500) break;
    const ra = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1200 * 2 ** attempt;
    if (Date.now() + wait > deadline - 2500) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(lastErr || "LLM request failed");
}

export function parseArgs(s: string | undefined): Record<string, any> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
