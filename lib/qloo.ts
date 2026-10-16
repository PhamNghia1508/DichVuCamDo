// Qloo client. Server-side only in live mode: the key never reaches the browser.
//
// Endpoints used (hackathon base URL, GET only):
//   GET /search            — resolve free-text tastes to Qloo entity IDs
//   GET /v2/insights       — taste-based recommendations (filter.type + signals)
//   GET /v2/tags           — look up valid tag IDs (e.g. restaurant, bar)
// The legacy /recs and /recommendations endpoints are intentionally never used.
//
// Responses are used in-memory only; nothing is written to disk or the repo.

import { Entity, KIND_URN, TargetKind, TasteKind } from "./types";
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

export interface QlooClient {
  mode: "live" | "mock";
  search(query: string, kind: TasteKind): Promise<Entity | null>;
  insights(opts: {
    type: TargetKind;
    entityIds: string[];
    city?: string;
    tagIds?: string[];
    excludeIds?: string[];
    /** Restrict results to these entity IDs (filter.results.entities) to score known candidates. */
    resultIds?: string[];
    take?: number;
  }): Promise<InsightResult[]>;
  findTags(query: string): Promise<TagResult[]>;
}

const env = (k: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[k] : undefined;

export function getQloo(): QlooClient {
  const key = env("QLOO_API_KEY");
  if (!key || env("TASTECIRCLE_FORCE_MOCK")) return mockClient;
  return liveClient(key, env("QLOO_BASE_URL") || "https://hackathon.api.qloo.com");
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function kindFromTypes(types: unknown, fallback: TasteKind): TasteKind {
  const list: string[] = Array.isArray(types) ? (types as string[]) : typeof types === "string" ? [types] : [];
  for (const t of list) {
    if (t.includes("artist")) return "artist";
    if (t.includes("movie")) return "movie";
    if (t.includes("place")) return "place";
    if (t.includes("book")) return "book";
  }
  return fallback;
}

export function toEntity(raw: any, fallback: TasteKind): Entity {
  const p = raw?.properties ?? {};
  const kind = kindFromTypes(raw?.types ?? raw?.type ?? raw?.subtype, fallback);
  const tags: string[] = Array.isArray(raw?.tags)
    ? raw.tags.map((t: any) => t?.name).filter(Boolean).slice(0, 6)
    : [];
  const subtitle =
    kind === "movie"
      ? [p.release_year, Array.isArray(raw?.tags) ? raw.tags.find((t: any) => String(t?.type).includes("genre"))?.name : undefined]
          .filter(Boolean)
          .join(" · ")
      : kind === "place"
        ? tags[0]
        : kind === "book"
          ? p.publication_year
            ? String(p.publication_year)
            : undefined
          : tags[0];
  return {
    id: String(raw?.entity_id ?? raw?.id ?? ""),
    name: String(raw?.name ?? "Unknown"),
    kind,
    subtitle: subtitle || undefined,
    address: p.address ?? undefined,
    image: p.image?.url ?? (typeof p.image === "string" ? p.image : undefined),
    tags,
    priceLevel: typeof p.price_level === "number" ? p.price_level : undefined,
    rating: typeof p.business_rating === "number" ? p.business_rating : undefined,
    url: p.website ?? p.external?.resy?.url ?? undefined,
  };
}

function parseExplain(raw: any): Record<string, number> {
  // feature.explainability puts per-result attributions under query.explainability.
  // The exact nesting can vary, so walk it defensively and collect {entity_id, score}.
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

// The hackathon key is rate-limited, so live calls go through a small queue
// (max 2 in flight, spaced out), retry 429/5xx with backoff, and are cached in memory.
const MAX_IN_FLIGHT = 2;
const MIN_GAP_MS = 350;
let inFlight = 0;
let lastStart = 0;
const waiters: Array<() => void> = [];
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 30 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const wait = lastStart + MIN_GAP_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS);
  if (wait > 0) await sleep(wait);
}
function release() {
  inFlight--;
  waiters.shift()?.();
}

function liveClient(apiKey: string, base: string): QlooClient {
  async function get(path: string, params: Record<string, string | number | undefined>) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const cacheKey = url.toString();
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as any;
    let lastErr = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      await acquire();
      let res: Response;
      try {
        res = await fetch(url, { method: "GET", headers: { "X-Api-Key": apiKey, accept: "application/json" }, cache: "no-store" });
      } finally {
        release();
      }
      if (res.ok) {
        const data = await res.json();
        cache.set(cacheKey, { at: Date.now(), data });
        return data;
      }
      const text = await res.text().catch(() => "");
      lastErr = `Qloo ${path} ${res.status}: ${text.slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt);
    }
    throw new Error(lastErr);
  }

  return {
    mode: "live",
    async search(query, kind) {
      const data = await get("/search", { query, types: KIND_URN[kind], take: 3 });
      const first = (data?.results ?? data?.entities ?? [])[0];
      return first ? toEntity(first, kind) : null;
    },
    async insights({ type, entityIds, city, tagIds, excludeIds, resultIds, take = 20 }) {
      if (!entityIds.length) return [];
      const params: Record<string, string | number | undefined> = {
        "filter.type": KIND_URN[type],
        "signal.interests.entities": entityIds.join(","),
        "feature.explainability": "true",
        take,
      };
      if (type === "place" && city) params["filter.location.query"] = city;
      if (type === "place" && tagIds?.length) params["filter.tags"] = tagIds.join(",");
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

export const mockClient: QlooClient = {
  mode: "mock",
  async search(query, kind) {
    return mock.resolve(query, kind);
  },
  async insights(opts) {
    return mock.insights(opts);
  },
  async findTags(query) {
    return mock.findTags(query);
  },
};
