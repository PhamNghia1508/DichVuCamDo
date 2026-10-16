// Copywriter pass. The tool-calling agent (a small, fast model) decides WHAT the
// night is; one call to a stronger writer model then rewrites the words — title,
// summary, blurbs and every per-friend reason — from the same Qloo facts only.
// Each reason must name a favourite Qloo's explainability credited to that friend,
// or it is thrown away and the agent's version stays. Any failure keeps the draft.

import type { Plan, Slot } from "../types";
import { pct, step, type Ctx } from "./context";
import { chat, llmConfig } from "./llm";

const env = (k: string): string | undefined => (typeof process !== "undefined" && process.env ? process.env[k] : undefined);

const STYLE = [
  "You write the words for TasteCircle, a group night-out planner. Voice: a sharp, warm friend in the group chat — not a brochure, not a horoscope.",
  "Use ONLY the facts given. Never invent dishes, prices, menus, history or awards.",
  "why (per friend): second person, 12–22 words, must name at least one of that friend's `credited` favourites exactly as written, and tie it to ONE concrete fact about the pick (category, neighbourhood, price, noise, tags, genre, year). Vary openings across friends; never start with their name.",
  "If a friend's fit is under 30, be honest it's a stretch and say what's in it for them.",
  "Write naturally: never mention tags, scores, 'fit', 'credited', 'Qloo data', and never put words in quotes. Don't write 'X fans'. Don't restate the category label verbatim if it reads clunky (say 'a cocktail bar on the 18th floor', not 'the Cocktail bar').",
  "Good: 'Lost in Translation, but make it dinner — a moderate-noise sushi counter in Little Italy built for long late talks.' Good: 'Your Kendrick Lamar rotation is why this loud, late Lower East Side bar made the cut.' Good: 'A stretch for you, honestly — but it's $$, it's lively, and the playlist after is all yours.'",
  "Banned: vibe, vibes, resonate, perfect, perfectly, brings, bring, energy, atmosphere, journey, curated, elevate, delight, seamless, ‘you enjoy’, ‘you appreciate’, ‘you love’ more than once.",
  "blurb: one plain sentence, max 22 words, what the place/film/playlist is and why it suits this group.",
  "title: 3–6 words, specific and a little witty, no colon, no city name unless it's the joke. summary: two short sentences naming the trade-off the plan made (who gave a little, who got their pick).",
].join(" ");

export async function polishCopy(ctx: Ctx, plan: Plan, slots: Slot[]): Promise<Plan> {
  const cfg = llmConfig();
  if (!cfg || !slots.length) return plan;
  const model = env("LLM_WRITER_MODEL") || (/openai\.com/.test(cfg.base) ? "gpt-4.1" : cfg.model);
  const fp = Object.fromEntries((plan.tasteMap?.members ?? []).map((m) => [m.name, m.tags.slice(0, 4).map((t) => t.name)]));
  const facts = plan.stops
    .filter((s) => slots.includes(s.slot))
    .map((s) => ({
      slot: s.slot,
      pick: s.entity?.name ?? s.entities?.map((e) => e.name).join(", "),
      about: s.entity
        ? [s.entity.subtitle, ...(s.entity.facets?.categories?.slice(1, 2) ?? []), s.entity.neighborhood, s.entity.priceLevel ? "$".repeat(s.entity.priceLevel) : null, s.entity.facets?.noise ? `${s.entity.facets.noise.toLowerCase()} noise` : null, ...(s.entity.tags ?? [])].filter(Boolean)
        : s.entities?.map((e) => `${e.name} (${e.subtitle ?? "artist"})`),
      bridge_for: s.bridgeFor,
      friends: Object.fromEntries(
        plan.members.map((m) => [m, { fit: pct(s.memberScores?.[m]), credited: (s.drivers?.[m] ?? []).map((d) => d.name) }]),
      ),
    }));
  const whyProps = Object.fromEntries(plan.members.map((m) => [m, { type: "string" }]));
  const stopSchema = { type: "object", properties: { blurb: { type: "string" }, why: { type: "object", properties: whyProps, required: plan.members, additionalProperties: false } }, required: ["blurb", "why"], additionalProperties: false };
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      stops: { type: "object", properties: Object.fromEntries(facts.map((f) => [f.slot, stopSchema])), required: facts.map((f) => f.slot), additionalProperties: false },
    },
    required: ["title", "summary", "stops"],
    additionalProperties: false,
  };
  try {
    const out = await step(ctx, "write_copy", `Writing a reason for each of you`, async () => {
      const msg = await chat(
        cfg,
        {
          model,
          messages: [
            { role: "system", content: STYLE },
            {
              role: "user",
              content: `City: ${plan.city}.${plan.vibe ? ` Vibe: ${plan.vibe}.` : ""} Friends' taste fingerprints (Qloo): ${JSON.stringify(fp)}\nDraft title: ${plan.title}\nStops: ${JSON.stringify(facts)}`,
            },
          ],
          response_format: { type: "json_schema", json_schema: { name: "copy", strict: true, schema } },
          max_tokens: 1400,
          temperature: 0.8,
        },
        Date.now() + 14_000,
      );
      const data = JSON.parse(String(msg.content ?? "{}")) as { title?: string; summary?: string; stops?: Record<string, { blurb?: string; why?: Record<string, string> }> };
      let kept = 0;
      let total = 0;
      const stops = plan.stops.map((s) => {
        const w = data.stops?.[s.slot];
        if (!w) return s;
        const why = { ...s.whyByMember };
        for (const m of plan.members) {
          const line = w.why?.[m]?.trim();
          const credited = (s.drivers?.[m] ?? []).map((d) => d.name.toLowerCase());
          total++;
          // grounded or honest: must name a credited favourite, unless none were credited
          if (line && (credited.length === 0 || credited.some((c) => line.toLowerCase().includes(c.toLowerCase())))) {
            why[m] = line;
            kept++;
          }
        }
        return { ...s, blurb: w.blurb?.trim() || s.blurb, whyByMember: why };
      });
      return {
        value: { ...plan, title: (data.title?.trim() || plan.title).slice(0, 70), summary: data.summary?.trim() || plan.summary, stops },
        summary: `${kept}/${total} reasons rewritten · each names a favourite Qloo credited`,
      };
    });
    return out;
  } catch {
    return plan;
  }
}
