// The circle's taste map, straight from Qloo:
//   • one taste-analysis call per member (GET /v2/insights, filter.type=urn:tag)
//     → the music genres and story keywords that define that member's taste,
//     across everything they entered (artists, films, shows, books, podcasts)
//   • overlap of those tag lists → what the group shares, and how close each pair is
//   • one GET /v2/insights/compare between the two furthest-apart members →
//     the tags that bridge them (what the planner should lean on)

import type { QlooClient, TagAffinity } from "../qloo";
import type { ResolvedMember, TasteMap, TasteTag } from "../types";
import { activeMembers, idsFor } from "./consensus";

const TAG_TYPES = ["urn:tag:genre:music", "urn:tag:genre:media", "urn:tag:keyword:media"];

const kindOf = (subtype: string) => (/music/.test(subtype) ? "music" : /keyword/.test(subtype) ? "story" : "genre");
const norm = (s: string) => s.trim().toLowerCase();
// identity and content-warning keywords are real Qloo tags but read badly as someone's "taste"
const SENSITIVE = /\b(gay|lesbian|lgbt\w*|queer|transgender|race|racism|racial|sex|sexual\w*|nudity|drugs?|violence|murder|suicide|death|rape|abuse|religion|religious|christian\w*|muslim|jewish|islam\w*|disability|terroris\w*|slavery|incest|prostitut\w*|blood|gore|holocaust)\b/i;
const NOISE = /^(united states|canada|ireland|australia|english|fiction|novels|literature|based on novel or book|duringcreditsstinger|aftercreditsstinger|woman director|\d+)$/i;

function clean(tags: TagAffinity[]): TasteTag[] {
  const seen = new Set<string>();
  const out: TasteTag[] = [];
  for (const t of tags) {
    const n = t.name.trim();
    if (!n || NOISE.test(n) || SENSITIVE.test(n) || seen.has(norm(n))) continue;
    seen.add(norm(n));
    out.push({ name: n, kind: kindOf(t.subtype), weight: Number(t.score.toFixed(3)) });
  }
  return out;
}

export async function buildTasteMap(qloo: QlooClient, members: ResolvedMember[]): Promise<TasteMap> {
  const active = activeMembers(members);
  const lists = await Promise.all(active.map((m) => qloo.tasteTags(idsFor(m), TAG_TYPES, 18).catch(() => [] as TagAffinity[])));
  const per = active.map((m, i) => ({
    name: m.name,
    tags: clean(lists[i]).slice(0, 10),
    likes: m.tastes.filter((t) => t.entity).map((t) => t.entity!.name),
  }));

  // shared tags: present in ≥2 members' fingerprints
  const byTag = new Map<string, { name: string; members: string[]; weight: number }>();
  for (const m of per)
    for (const t of m.tags) {
      const k = norm(t.name);
      const e = byTag.get(k) ?? { name: t.name, members: [], weight: 0 };
      if (!e.members.includes(m.name)) e.members.push(m.name);
      e.weight += t.weight;
      byTag.set(k, e);
    }
  const shared = [...byTag.values()]
    .filter((t) => t.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length || b.weight - a.weight)
    .slice(0, 8)
    .map((t) => ({ ...t, weight: Number(t.weight.toFixed(3)) }));

  // pairwise similarity: weighted overlap of fingerprints
  const pairs: TasteMap["pairs"] = [];
  for (let i = 0; i < per.length; i++)
    for (let j = i + 1; j < per.length; j++) {
      const a = new Map(per[i].tags.map((t) => [norm(t.name), t.weight]));
      const b = new Map(per[j].tags.map((t) => [norm(t.name), t.weight]));
      let inter = 0;
      let union = 0;
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        inter += Math.min(a.get(k) ?? 0, b.get(k) ?? 0);
        union += Math.max(a.get(k) ?? 0, b.get(k) ?? 0);
      }
      pairs.push({ a: per[i].name, b: per[j].name, similarity: union ? Number((inter / union).toFixed(3)) : 0 });
    }

  const map: TasteMap = { members: per, shared, pairs };
  const far = [...pairs].sort((x, y) => x.similarity - y.similarity)[0];
  if (far) {
    const A = active.find((m) => m.name === far.a)!;
    const B = active.find((m) => m.name === far.b)!;
    const common = await qloo.compare(idsFor(A), idsFor(B), 14).catch(() => [] as TagAffinity[]);
    const tags = clean(common.filter((t) => !/region|instrument|audience|credit_card|hotel/.test(t.subtype)))
      .slice(0, 5)
      .map((t) => t.name);
    if (tags.length) map.bridge = { a: far.a, b: far.b, tags };
  }
  return map;
}

/** One line the LLM (and the UI) can use: what holds this circle together. */
export function tasteMapBrief(map: TasteMap): string {
  const parts = map.members.map((m) => `${m.name}: ${m.tags.slice(0, 4).map((t) => t.name).join(", ")}`);
  const shared = map.shared.length ? ` Shared: ${map.shared.slice(0, 4).map((s) => `${s.name} (${s.members.join("+")})`).join(", ")}.` : "";
  const bridge = map.bridge ? ` Furthest apart: ${map.bridge.a} & ${map.bridge.b}; Qloo compare says they meet on ${map.bridge.tags.slice(0, 3).join(", ")}.` : "";
  return `Taste fingerprints — ${parts.join(" | ")}.${shared}${bridge}`;
}
