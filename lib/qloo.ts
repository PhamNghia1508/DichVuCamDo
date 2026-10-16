// Qloo client. Server-side only in live mode: the key never reaches the browser.
//
// Endpoints used (hackathon base URL, GET only):
//   GET /search              resolve free-text tastes to Qloo entities (artist, movie, tv_show, book, podcast, place)
//   GET /v2/insights         recommendations for a filter.type (place / movie / artist) from entity signals,
//                            with feature.explainability, filter.tags (+ operator), filter.exclude.tags,
//                            filter.price_level.max, filter.location.query, filter.results.entities
//   GET /v2/insights         filter.type=urn:tag — taste analysis: the tags that define a member's taste
//   GET /v2/insights/compare which tags two members' tastes have in common (the "taste bridge")
//   GET /v2/tags             look up valid tag IDs (venue categories, dietary options, noise level…)
// The legacy /recs and /recommendations endpoints are intentionally never used.
//
// Responses are used in memory only; nothing is written to disk or the repo.

import { ENTITY_URN, KIND_SEARCH, type Entity, type EntityKind, type Facets, type TargetKind, type TasteKind } from "./types";
import * as mock from "./mock/catalog";

export interface InsightResult {
  entity: Entity;
  affinity: number;
  /** input entity id -> contribution score (from feature.explainability) */
  explain: Record<string, number>;
}

export interface TagResult {
  id: string;
  name: string;
  type?: string;
}

export interface TagAffinity {
  id: string;
  name: string;
  subtype: string;
  score: number;
}

export interface InsightOptions {
  type: TargetKind;
  entityIds: string[];
  city?: string;
  tagIds?: string[];
  /** how filter.tags combine; Qloo default is intersection */
  tagsOperator?: "union" | "intersection";
  excludeTagIds?: string[];
  priceMax?: number;
  excludeIds?: string[];
  /** Restrict results to these entity IDs (filter.results.entities) to score known candidates. */
  resultIds?: string[];
  take?: number;
}

export interface QlooClient {
  mode: "live" | "mock";
  search(query: string, kind: TasteKind, city?: string): Promise<Entity | null>;
  /** candidate matches for a named place (used to audit what a plain LLM suggests): name alone + "name city" */
  searchPlaces(name: string, city: string): Promise<Entity[]>;
  insights(opts: InsightOptions): Promise<InsightResult[]>;
  tasteTags(entityIds: string[], tagTypes: string[], take?: number): Promise<TagAffinity[]>;
  compare(aIds: string[], bIds: string[], take?: number): Promise<TagAffinity[]>;
  findTags(query: string): Promise<TagResult[]>;
  /** number of HTTP calls this client instance has made (live) or simulated (mock) */
  calls(): number;
}

const env = (k: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[k] : undefined;

export function getQloo(): QlooClient {
  const key = env("QLOO_API_KEY");
  if (!key || env("TASTECIRCLE_FORCE_MOCK")) return makeMockClient();
  return liveClient(key, env("QLOO_BASE_URL") || "https://hackathon.api.qloo.com");
}

// ---------------------------------------------------------------------------
// Entity projection
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function kindFromTypes(types: unknown, fallback: EntityKind): EntityKind {
  const list: string[] = Array.isArray(types) ? (types as string[]) : typeof types === "string" ? [types] : [];
  for (const t of list) {
    if (t.endsWith(":artist")) return "artist";
    if (t.endsWith(":tv_show")) return "tv_show";
    if (t.endsWith(":movie")) return "movie";
    if (t.endsWith(":podcast")) return "podcast";
    if (t.endsWith(":book")) return "book";
    if (t.endsWith(":place")) return "place";
  }
  return fallback;
}

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];

function facetsOf(raw: any): Facets {
  const tags: any[] = Array.isArray(raw?.tags) ? raw.tags : [];
  const of = (re: RegExp) => uniq(tags.filter((t) => re.test(String(t?.type ?? ""))).map((t) => String(t?.name ?? "")));
  const dietary = uniq(
    tags
      .filter((t) => /dietary|offerings/.test(String(t?.type)) || /vegetarian|vegan|halal|gluten/.test(String(t?.id)))
      .map((t) => String(t?.name ?? ""))
      .filter((n) => /vegetarian|vegan|halal|gluten|plant/i.test(n)),
  );
  return {
    categories: of(/category:place/).slice(0, 5),
    dietary: dietary.slice(0, 4),
    noise: of(/noise_level/)[0],
    vibe: of(/ambience/).slice(0, 4),
    cuisine: of(/cuisine/).slice(0, 3),
  };
}

export function toEntity(raw: any, fallback: EntityKind): Entity {
  const p = raw?.properties ?? {};
  const kind = kindFromTypes(raw?.types ?? raw?.type ?? raw?.subtype, fallback);
  const tagList: any[] = Array.isArray(raw?.tags) ? raw.tags : [];
  const facets = kind === "place" ? facetsOf(raw) : undefined;
  const genre = tagList.find((t) => /genre/.test(String(t?.type)))?.name;
  const tags: string[] =
    kind === "place"
      ? uniq([...(facets?.vibe ?? []), ...(facets?.cuisine ?? [])]).slice(0, 4)
      : uniq(tagList.filter((t) => /genre|keyword/.test(String(t?.type))).map((t) => t?.name)).slice(0, 4);
  const year = p.release_year ?? p.publication_year;
  const subtitle =
    kind === "place"
      ? facets?.categories?.[0] ?? tags[0]
      : kind === "movie" || kind === "tv_show"
        ? [year, genre, kind === "tv_show" ? "Series" : undefined].filter(Boolean).join(" · ")
        : kind === "book"
          ? year
            ? String(year)
            : undefined
          : genre ?? tags[0];
  const img = Array.isArray(p.images) && p.images[0]?.url ? p.images[0].url : p.image?.url ?? (typeof p.image === "string" ? p.image : undefined);
  return {
    id: String(raw?.entity_id ?? raw?.id ?? ""),
    name: String(raw?.name ?? "Unknown"),
    kind,
    subtitle: subtitle ? String(subtitle).replace(/^\s+/, "") : undefined,
    address: p.address ?? undefined,
    neighborhood: typeof p.neighborhood === "string" ? p.neighborhood : undefined,
    image: typeof img === "string" && img.startsWith("https://") ? img : undefined,
    tags,
    priceLevel: typeof p.price_level === "number" ? p.price_level : undefined,
    rating: typeof p.business_rating === "number" ? p.business_rating : undefined,
    url: p.website ?? p.external?.resy?.url ?? undefined,
    popularity: typeof raw?.popularity === "number" ? raw.popularity : undefined,
    facets,
  };
}

function parseExplain(raw: any): Record<string, number> {
  // feature.explainability → query.explainability["signal.interests.entities"] = [{entity_id, score}]
  const out: Record<string, number> = {};
  const visit = (node: any, depth: number) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (typeof node === "object") {
      const id = node.entity_id ?? node.id;
      if (id && typeof node.score === "number") out[String(id)] = node.score;
      for (const v of Object.values(node)) if (typeof v === "object") visit(v, depth + 1);
    }
  };
  visit(raw?.query?.explainability, 0);
  return out;
}

function tagAffinities(list: any[], scoreOf: (t: any) => number): TagAffinity[] {
  return list
    .map((t) => ({
      id: String(t?.tag_id ?? t?.id ?? ""),
      name: String(t?.name ?? "").trim(),
      subtype: String(t?.subtype ?? t?.type ?? ""),
      score: scoreOf(t),
    }))
    .filter((t) => t.name);
}

// ---------------------------------------------------------------------------
// Live client. The hackathon key allows 5 requests/second, so every call goes
// through one shared queue (≤4 in flight, ≥210 ms between starts), 429/5xx are
// retried with backoff, and responses are cached in memory for 30 minutes.
// ---------------------------------------------------------------------------

const MAX_IN_FLIGHT = 4;
const MIN_GAP_MS = 210;
let inFlight = 0;
let lastStart = 0;
const waiters: Array<() => void> = [];
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const now = Date.now();
  const start = Math.max(now, lastStart + MIN_GAP_MS);
  lastStart = start;
  if (start > now) await sleep(start - now);
}
function release() {
  inFlight--;
  waiters.shift()?.();
}

function liveClient(apiKey: string, base: string): QlooClient {
  let count = 0;
  async function get(path: string, params: Record<string, string | number | undefined>) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const cacheKey = url.toString();
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as any;
    let lastErr = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      await acquire();
      let res: Response;
      try {
        count++;
        res = await fetch(url, {
          method: "GET",
          headers: { "X-Api-Key": apiKey, accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
      } catch (err) {
        release();
        lastErr = `Qloo ${path}: ${(err as Error).message}`;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      release();
      if (res.ok) {
        const data = await res.json();
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(cacheKey, { at: Date.now(), data });
        return data;
      }
      const text = await res.text().catch(() => "");
      lastErr = `Qloo ${path} ${res.status}: ${text.slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 700 * 2 ** attempt);
    }
    throw new Error(lastErr);
  }

  return {
    mode: "live",
    calls: () => count,
    async search(query, kind, city) {
      const types = KIND_SEARCH[kind].map((k) => ENTITY_URN[k]).join(",");
      if (kind === "place") {
        // "ramen" or "a bar I love" isn't a name: only accept a place whose name or tags contain the words,
        // trying the user's city first so the signal is a real local spot
        const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const fits = (r: any) => {
          const hay = `${r?.name ?? ""} ${(r?.tags ?? []).map((t: any) => t?.name).join(" ")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        };
        for (const q of city ? [`${query} ${city}`, query] : [query]) {
          const data = await get("/search", { query: q, types, take: 5 }).catch(() => null);
          const hit = (data?.results ?? []).find(fits);
          if (hit) return toEntity(hit, "place");
        }
        return null;
      }
      const data = await get("/search", { query, types, take: 3 });
      const first = (data?.results ?? data?.entities ?? [])[0];
      return first ? toEntity(first, KIND_SEARCH[kind][0]) : null;
    },
    async searchPlaces(name, city) {
      const [a, b] = await Promise.all([
        get("/search", { query: name, types: ENTITY_URN.place, take: 5 }).catch(() => null),
        get("/search", { query: `${name} ${city}`, types: ENTITY_URN.place, take: 5 }).catch(() => null),
      ]);
      const seen = new Set<string>();
      return [...(a?.results ?? []), ...(b?.results ?? [])]
        .map((r: any) => toEntity(r, "place"))
        .filter((e: Entity) => !seen.has(e.id) && !!seen.add(e.id));
    },
    async insights({ type, entityIds, city, tagIds, tagsOperator, excludeTagIds, priceMax, excludeIds, resultIds, take = 20 }) {
      if (!entityIds.length) return [];
      const params: Record<string, string | number | undefined> = {
        "filter.type": ENTITY_URN[type],
        "signal.interests.entities": entityIds.join(","),
        "feature.explainability": "true",
        take,
      };
      if (type === "place" && city && !resultIds?.length) params["filter.location.query"] = city;
      if (tagIds?.length) params["filter.tags"] = tagIds.join(",");
      if (tagIds && tagIds.length > 1 && tagsOperator) params["operator.filter.tags"] = tagsOperator;
      if (excludeTagIds?.length) params["filter.exclude.tags"] = excludeTagIds.join(",");
      if (type === "place" && priceMax) params["filter.price_level.max"] = priceMax;
      if (excludeIds?.length) params["filter.exclude.entities"] = excludeIds.join(",");
      if (resultIds?.length) params["filter.results.entities"] = resultIds.join(",");
      const data = await get("/v2/insights", params);
      const list: any[] = data?.results?.entities ?? [];
      return list.map((raw, i) => ({
        entity: toEntity(raw, type),
        affinity: typeof raw?.query?.affinity === "number" ? raw.query.affinity : Math.max(0.05, 1 - i / (list.length + 1)),
        explain: parseExplain(raw),
      }));
    },
    async tasteTags(entityIds, tagTypes, take = 15) {
      if (!entityIds.length) return [];
      const data = await get("/v2/insights", {
        "filter.type": "urn:tag",
        "filter.tag.types": tagTypes.join(","),
        "signal.interests.entities": entityIds.join(","),
        take,
      });
      return tagAffinities(data?.results?.tags ?? [], (t) => Number(t?.query?.affinity ?? 0));
    },
    async compare(aIds, bIds, take = 12) {
      if (!aIds.length || !bIds.length) return [];
      const data = await get("/v2/insights/compare", {
        "a.signal.interests.entities": aIds.join(","),
        "b.signal.interests.entities": bIds.join(","),
        take,
      });
      return tagAffinities(data?.results?.tags ?? [], (t) => Number(t?.query?.score ?? 0));
    },
    async findTags(query) {
      const data = await get("/v2/tags", { "filter.query": query, take: 10 });
      const list: any[] = data?.results?.tags ?? data?.results ?? [];
      return list.map((t) => ({ id: String(t.id ?? t.tag_id), name: String(t.name ?? t.id), type: t.type }));
    },
  };
}

// ---------------------------------------------------------------------------
// Mock client — hand-written catalog, no Qloo data involved.
// ---------------------------------------------------------------------------

export function makeMockClient(): QlooClient {
  let count = 0;
  const tick = <T>(v: T) => {
    count++;
    return v;
  };
  return {
    mode: "mock",
    calls: () => count,
    async search(query, kind) {
      return tick(mock.resolve(query, kind));
    },
    async searchPlaces(name, city) {
      const e = mock.searchPlace(name, city);
      return tick(e ? [e] : []);
    },
    async insights(opts) {
      return tick(mock.insights(opts));
    },
    async tasteTags(ids, types, take) {
      return tick(mock.tasteTags(ids, take));
    },
    async compare(a, b, take) {
      return tick(mock.compare(a, b, take));
    },
    async findTags(query) {
      return tick(mock.findTags(query));
    },
  };
}

/** Shared default mock client (tests and the static demo). */
export const mockClient: QlooClient = makeMockClient();
