// MOCK MODE catalog.
//
// Everything in this file was written by hand for demos and tests. It is NOT
// Qloo data and was not generated from Qloo responses. Venue names are
// fictional; artists, films and books are real titles tagged with hand-picked
// "vibe" words so the overlap math has something to chew on.

import type { Entity, EntityKind, TargetKind, TasteKind } from "../types";
import type { InsightOptions, InsightResult, TagAffinity, TagResult } from "../qloo";

type Vibe =
  | "indie" | "electronic" | "jazz" | "hiphop" | "pop" | "rock" | "folk" | "classical" | "kpop" | "latin" | "rnb" | "ambient"
  | "scifi" | "romance" | "comedy" | "horror" | "arthouse" | "animation" | "thriller" | "drama" | "anime" | "adventure"
  | "asian" | "italian" | "mexican" | "vegan" | "spicy" | "street-food" | "fine-dining" | "coffee" | "cocktails"
  | "cozy" | "lively" | "late-night" | "retro" | "nature" | "literary" | "nostalgic" | "dreamy" | "energetic" | "chill"
  | "cerebral" | "quirky" | "melancholy" | "glam";

const VIBES: Vibe[] = [
  "indie", "electronic", "jazz", "hiphop", "pop", "rock", "folk", "classical", "kpop", "latin", "rnb", "ambient",
  "scifi", "romance", "comedy", "horror", "arthouse", "animation", "thriller", "drama", "anime", "adventure",
  "asian", "italian", "mexican", "vegan", "spicy", "street-food", "fine-dining", "coffee", "cocktails",
  "cozy", "lively", "late-night", "retro", "nature", "literary", "nostalgic", "dreamy", "energetic", "chill",
  "cerebral", "quirky", "melancholy", "glam",
];

const KIND_BIAS: Record<TasteKind, Vibe[]> = {
  artist: ["indie", "electronic", "jazz", "hiphop", "pop", "rock", "folk", "rnb", "dreamy", "energetic", "melancholy", "chill"],
  movie: ["scifi", "romance", "comedy", "arthouse", "animation", "thriller", "drama", "adventure", "cerebral", "quirky", "nostalgic"],
  place: ["asian", "italian", "mexican", "vegan", "spicy", "street-food", "coffee", "cocktails", "cozy", "lively", "late-night"],
  book: ["literary", "scifi", "romance", "cerebral", "melancholy", "adventure", "quirky", "nature", "dreamy"],
};

// Common inputs people type, mapped to hand-picked vibes.
const KNOWN: Record<string, { kind: TasteKind; name: string; vibes: Vibe[]; subtitle?: string; as?: EntityKind }> = {
  // tv & podcasts (searched from the Film & TV / Books & podcasts rows)
  "breaking bad": { kind: "movie", as: "tv_show", name: "Breaking Bad", subtitle: "2008 · Series", vibes: ["thriller", "drama", "cerebral"] },
  "the bear": { kind: "movie", as: "tv_show", name: "The Bear", subtitle: "2022 · Series", vibes: ["drama", "fine-dining", "energetic", "comedy"] },
  "fleabag": { kind: "movie", as: "tv_show", name: "Fleabag", subtitle: "2016 · Series", vibes: ["comedy", "quirky", "melancholy"] },
  "the office": { kind: "movie", as: "tv_show", name: "The Office", subtitle: "2005 · Series", vibes: ["comedy", "quirky", "cozy"] },
  "serial": { kind: "book", as: "podcast", name: "Serial", subtitle: "Podcast", vibes: ["thriller", "cerebral", "literary"] },
  "song exploder": { kind: "book", as: "podcast", name: "Song Exploder", subtitle: "Podcast", vibes: ["indie", "cerebral", "literary"] },
  // artists
  "radiohead": { kind: "artist", name: "Radiohead", vibes: ["indie", "rock", "melancholy", "cerebral", "electronic"] },
  "taylor swift": { kind: "artist", name: "Taylor Swift", vibes: ["pop", "romance", "nostalgic", "folk"] },
  "kendrick lamar": { kind: "artist", name: "Kendrick Lamar", vibes: ["hiphop", "cerebral", "energetic"] },
  "billie eilish": { kind: "artist", name: "Billie Eilish", vibes: ["pop", "dreamy", "melancholy", "indie"] },
  "daft punk": { kind: "artist", name: "Daft Punk", vibes: ["electronic", "retro", "energetic", "glam"] },
  "bts": { kind: "artist", name: "BTS", vibes: ["kpop", "pop", "energetic", "glam"] },
  "newjeans": { kind: "artist", name: "NewJeans", vibes: ["kpop", "pop", "nostalgic", "dreamy"] },
  "norah jones": { kind: "artist", name: "Norah Jones", vibes: ["jazz", "cozy", "chill", "romance"] },
  "frank ocean": { kind: "artist", name: "Frank Ocean", vibes: ["rnb", "dreamy", "melancholy", "indie"] },
  "sza": { kind: "artist", name: "SZA", vibes: ["rnb", "pop", "romance", "dreamy"] },
  "bad bunny": { kind: "artist", name: "Bad Bunny", vibes: ["latin", "energetic", "lively", "hiphop"] },
  "the beatles": { kind: "artist", name: "The Beatles", vibes: ["rock", "nostalgic", "retro", "pop"] },
  "phoebe bridgers": { kind: "artist", name: "Phoebe Bridgers", vibes: ["indie", "folk", "melancholy", "literary"] },
  "tame impala": { kind: "artist", name: "Tame Impala", vibes: ["indie", "dreamy", "retro", "electronic"] },
  "den vau": { kind: "artist", name: "Đen Vâu", vibes: ["hiphop", "chill", "literary", "nostalgic"] },
  "đen vâu": { kind: "artist", name: "Đen Vâu", vibes: ["hiphop", "chill", "literary", "nostalgic"] },
  "son tung m-tp": { kind: "artist", name: "Sơn Tùng M-TP", vibes: ["pop", "energetic", "glam"] },
  // movies
  "spirited away": { kind: "movie", name: "Spirited Away", subtitle: "2001 · Animation", vibes: ["animation", "anime", "dreamy", "adventure", "nostalgic"] },
  "interstellar": { kind: "movie", name: "Interstellar", subtitle: "2014 · Sci-fi", vibes: ["scifi", "cerebral", "drama", "adventure"] },
  "la la land": { kind: "movie", name: "La La Land", subtitle: "2016 · Musical", vibes: ["romance", "jazz", "dreamy", "nostalgic"] },
  "parasite": { kind: "movie", name: "Parasite", subtitle: "2019 · Thriller", vibes: ["thriller", "arthouse", "cerebral", "drama"] },
  "everything everywhere all at once": { kind: "movie", name: "Everything Everywhere All at Once", subtitle: "2022 · Sci-fi comedy", vibes: ["scifi", "comedy", "quirky", "drama"] },
  "in the mood for love": { kind: "movie", name: "In the Mood for Love", subtitle: "2000 · Romance", vibes: ["romance", "arthouse", "melancholy", "retro"] },
  "the grand budapest hotel": { kind: "movie", name: "The Grand Budapest Hotel", subtitle: "2014 · Comedy", vibes: ["comedy", "quirky", "retro", "adventure"] },
  "dune": { kind: "movie", name: "Dune", subtitle: "2021 · Sci-fi", vibes: ["scifi", "adventure", "cerebral"] },
  "barbie": { kind: "movie", name: "Barbie", subtitle: "2023 · Comedy", vibes: ["comedy", "pop", "quirky", "glam"] },
  "your name": { kind: "movie", name: "Your Name", subtitle: "2016 · Anime", vibes: ["anime", "animation", "romance", "dreamy"] },
  "pulp fiction": { kind: "movie", name: "Pulp Fiction", subtitle: "1994 · Crime", vibes: ["thriller", "retro", "comedy", "late-night"] },
  // places (generic)
  "pho": { kind: "place", name: "Phở", vibes: ["asian", "street-food", "cozy"] },
  "sushi": { kind: "place", name: "Sushi", vibes: ["asian", "fine-dining", "chill"] },
  "ramen": { kind: "place", name: "Ramen", vibes: ["asian", "late-night", "cozy", "spicy"] },
  "pizza": { kind: "place", name: "Pizza", vibes: ["italian", "lively", "cozy"] },
  "tacos": { kind: "place", name: "Tacos", vibes: ["mexican", "spicy", "street-food", "lively"] },
  "starbucks": { kind: "place", name: "Starbucks", vibes: ["coffee", "chill"] },
  "the coffee house": { kind: "place", name: "The Coffee House", vibes: ["coffee", "cozy", "chill"] },
  // books
  "norwegian wood": { kind: "book", name: "Norwegian Wood", subtitle: "Haruki Murakami", vibes: ["literary", "melancholy", "romance", "nostalgic"] },
  "dune book": { kind: "book", name: "Dune", subtitle: "Frank Herbert", vibes: ["scifi", "adventure", "cerebral"] },
  "the little prince": { kind: "book", name: "The Little Prince", subtitle: "Antoine de Saint-Exupéry", vibes: ["dreamy", "literary", "nostalgic", "quirky"] },
  "harry potter": { kind: "book", name: "Harry Potter", subtitle: "J.K. Rowling", vibes: ["adventure", "nostalgic", "quirky"] },
  "sapiens": { kind: "book", name: "Sapiens", subtitle: "Yuval Noah Harari", vibes: ["cerebral", "literary"] },
  "project hail mary": { kind: "book", name: "Project Hail Mary", subtitle: "Andy Weir", vibes: ["scifi", "comedy", "adventure", "cerebral"] },
};

interface MockItem extends Entity {
  vibes: Vibe[];
  role?: "restaurant" | "activity";
}

const ACTIVITY_TAG = /category:place:(bar|cocktail_bar|wine_bar|pub|live_music_venue|jazz_club|karaoke|comedy_club|night_club|bowling_alley|movie_theater|lounge|brewery)|mock:tag:place:activity/;
const RESTAURANT_TAG = /category:place:restaurant|mock:tag:place:restaurant/;

// Recommendation targets. Venue names are invented.
const PLACES: MockItem[] = [
  { id: "mock-p-01", kind: "place", role: "restaurant", name: "Lantern & Lime", subtitle: "Modern Vietnamese", vibes: ["asian", "cozy", "spicy", "nostalgic"], priceLevel: 2, rating: 4.6 },
  { id: "mock-p-02", kind: "place", role: "restaurant", name: "Nonna Neon", subtitle: "Italian trattoria", vibes: ["italian", "lively", "retro", "romance"], priceLevel: 2, rating: 4.5 },
  { id: "mock-p-03", kind: "place", role: "restaurant", name: "Midnight Ramen Club", subtitle: "Ramen bar", vibes: ["asian", "late-night", "spicy", "anime", "cozy"], priceLevel: 1, rating: 4.7 },
  { id: "mock-p-04", kind: "place", role: "restaurant", name: "Green Room Kitchen", subtitle: "Plant-based bistro", vibes: ["vegan", "chill", "indie", "nature"], priceLevel: 2, rating: 4.4 },
  { id: "mock-p-05", kind: "place", role: "restaurant", name: "Taco Sonido", subtitle: "Taquería & mezcal", vibes: ["mexican", "spicy", "lively", "latin", "energetic"], priceLevel: 1, rating: 4.5 },
  { id: "mock-p-06", kind: "place", role: "restaurant", name: "Saffron Library", subtitle: "Tasting menu", vibes: ["fine-dining", "literary", "cerebral", "jazz"], priceLevel: 4, rating: 4.8 },
  { id: "mock-p-07", kind: "place", role: "restaurant", name: "Seoul Arcade BBQ", subtitle: "Korean BBQ", vibes: ["asian", "kpop", "lively", "energetic", "glam"], priceLevel: 3, rating: 4.5 },
  { id: "mock-p-08", kind: "place", role: "restaurant", name: "Paper Crane Izakaya", subtitle: "Izakaya", vibes: ["asian", "dreamy", "late-night", "cocktails", "animation"], priceLevel: 2, rating: 4.6 },
  { id: "mock-p-09", kind: "place", role: "restaurant", name: "Smoke & Vinyl", subtitle: "BBQ & records", vibes: ["rock", "retro", "lively", "hiphop"], priceLevel: 2, rating: 4.3 },
  { id: "mock-p-10", kind: "place", role: "restaurant", name: "Street Lantern Market", subtitle: "Night food market", vibes: ["street-food", "asian", "lively", "late-night", "nostalgic"], priceLevel: 1, rating: 4.4 },
  { id: "mock-a-01", kind: "place", role: "activity", name: "Blue Hour Jazz Cellar", subtitle: "Live jazz bar", vibes: ["jazz", "cocktails", "romance", "melancholy", "cozy"], priceLevel: 2, rating: 4.7 },
  { id: "mock-a-02", kind: "place", role: "activity", name: "Starlight Rooftop Cinema", subtitle: "Open-air cinema", vibes: ["scifi", "romance", "dreamy", "arthouse", "nostalgic"], priceLevel: 2, rating: 4.6 },
  { id: "mock-a-03", kind: "place", role: "activity", name: "Pixel Palace Arcade", subtitle: "Retro arcade bar", vibes: ["retro", "quirky", "energetic", "electronic", "anime"], priceLevel: 1, rating: 4.5 },
  { id: "mock-a-04", kind: "place", role: "activity", name: "Echo Karaoke Lounge", subtitle: "Private karaoke rooms", vibes: ["pop", "kpop", "lively", "glam", "energetic"], priceLevel: 2, rating: 4.4 },
  { id: "mock-a-05", kind: "place", role: "activity", name: "Dog-Ear Bookshop Café", subtitle: "Late-night bookshop", vibes: ["literary", "coffee", "cozy", "cerebral", "folk"], priceLevel: 1, rating: 4.8 },
  { id: "mock-a-06", kind: "place", role: "activity", name: "Warehouse 9", subtitle: "Electronic music club", vibes: ["electronic", "late-night", "energetic", "hiphop"], priceLevel: 2, rating: 4.3 },
  { id: "mock-a-07", kind: "place", role: "activity", name: "The Small Room", subtitle: "Indie gig venue", vibes: ["indie", "rock", "folk", "melancholy", "energetic"], priceLevel: 1, rating: 4.6 },
  { id: "mock-a-08", kind: "place", role: "activity", name: "Glasshouse Gallery Nights", subtitle: "Art gallery late opening", vibes: ["arthouse", "cerebral", "dreamy", "ambient", "nature"], priceLevel: 1, rating: 4.5 },
  { id: "mock-a-09", kind: "place", role: "activity", name: "Laugh Track Comedy Club", subtitle: "Stand-up comedy", vibes: ["comedy", "quirky", "lively", "late-night"], priceLevel: 2, rating: 4.4 },
  { id: "mock-a-10", kind: "place", role: "activity", name: "Riverside Night Walk", subtitle: "Waterfront promenade", vibes: ["nature", "chill", "romance", "ambient", "folk"], priceLevel: 1, rating: 4.6 },
];

const MOVIES: MockItem[] = [
  { id: "mock-m-01", kind: "movie", name: "Before Sunrise", subtitle: "1995 · Romance", vibes: ["romance", "literary", "dreamy", "melancholy"] },
  { id: "mock-m-02", kind: "movie", name: "Arrival", subtitle: "2016 · Sci-fi", vibes: ["scifi", "cerebral", "drama", "melancholy"] },
  { id: "mock-m-03", kind: "movie", name: "Paddington 2", subtitle: "2017 · Comedy", vibes: ["comedy", "cozy", "quirky", "adventure"] },
  { id: "mock-m-04", kind: "movie", name: "Howl's Moving Castle", subtitle: "2004 · Animation", vibes: ["animation", "anime", "dreamy", "romance", "adventure"] },
  { id: "mock-m-05", kind: "movie", name: "Baby Driver", subtitle: "2017 · Action", vibes: ["energetic", "retro", "rock", "thriller"] },
  { id: "mock-m-06", kind: "movie", name: "Chungking Express", subtitle: "1994 · Romance", vibes: ["arthouse", "romance", "late-night", "quirky", "nostalgic"] },
  { id: "mock-m-07", kind: "movie", name: "Knives Out", subtitle: "2019 · Mystery", vibes: ["thriller", "comedy", "cerebral", "quirky"] },
  { id: "mock-m-08", kind: "movie", name: "Whiplash", subtitle: "2014 · Drama", vibes: ["jazz", "drama", "energetic"] },
  { id: "mock-m-09", kind: "movie", name: "Spider-Man: Into the Spider-Verse", subtitle: "2018 · Animation", vibes: ["animation", "hiphop", "energetic", "adventure"] },
  { id: "mock-m-10", kind: "movie", name: "Past Lives", subtitle: "2023 · Drama", vibes: ["romance", "melancholy", "drama", "literary"] },
  { id: "mock-m-11", kind: "movie", name: "Blade Runner 2049", subtitle: "2017 · Sci-fi", vibes: ["scifi", "ambient", "electronic", "melancholy"] },
  { id: "mock-m-12", kind: "movie", name: "Mamma Mia!", subtitle: "2008 · Musical", vibes: ["pop", "lively", "romance", "glam"] },
];

const ARTISTS: MockItem[] = [
  { id: "mock-r-01", kind: "artist", name: "Mitski", subtitle: "Indie rock", vibes: ["indie", "melancholy", "rock", "literary"] },
  { id: "mock-r-02", kind: "artist", name: "Khruangbin", subtitle: "Psychedelic soul", vibes: ["chill", "dreamy", "retro", "latin"] },
  { id: "mock-r-03", kind: "artist", name: "Jungle", subtitle: "Neo-soul / dance", vibes: ["electronic", "energetic", "retro", "rnb"] },
  { id: "mock-r-04", kind: "artist", name: "Laufey", subtitle: "Jazz pop", vibes: ["jazz", "romance", "cozy", "nostalgic"] },
  { id: "mock-r-05", kind: "artist", name: "Joe Hisaishi", subtitle: "Film score", vibes: ["classical", "animation", "dreamy", "nostalgic", "anime"] },
  { id: "mock-r-06", kind: "artist", name: "Fred again..", subtitle: "Electronic", vibes: ["electronic", "energetic", "melancholy", "late-night"] },
  { id: "mock-r-07", kind: "artist", name: "Anderson .Paak", subtitle: "Funk / R&B", vibes: ["rnb", "hiphop", "energetic", "lively"] },
  { id: "mock-r-08", kind: "artist", name: "beabadoobee", subtitle: "Indie pop", vibes: ["indie", "pop", "nostalgic", "dreamy"] },
  { id: "mock-r-09", kind: "artist", name: "Hiatus Kaiyote", subtitle: "Future soul", vibes: ["jazz", "rnb", "quirky", "cerebral"] },
  { id: "mock-r-10", kind: "artist", name: "IU", subtitle: "K-pop / ballad", vibes: ["kpop", "pop", "romance", "dreamy"] },
  { id: "mock-r-11", kind: "artist", name: "Bon Iver", subtitle: "Indie folk", vibes: ["folk", "indie", "melancholy", "nature", "ambient"] },
  { id: "mock-r-12", kind: "artist", name: "Rosalía", subtitle: "Flamenco pop", vibes: ["latin", "pop", "energetic", "glam"] },
  { id: "mock-r-13", kind: "artist", name: "Nujabes", subtitle: "Jazz hip-hop", vibes: ["hiphop", "jazz", "chill", "anime", "nostalgic"] },
  { id: "mock-r-14", kind: "artist", name: "Vũ.", subtitle: "Vietnamese indie", vibes: ["indie", "folk", "melancholy", "romance", "nostalgic"] },
  { id: "mock-r-15", kind: "artist", name: "Glass Animals", subtitle: "Psych pop", vibes: ["indie", "electronic", "quirky", "dreamy"] },
  { id: "mock-r-16", kind: "artist", name: "Fleetwood Mac", subtitle: "Classic rock", vibes: ["rock", "retro", "nostalgic", "romance"] },
];

const TARGETS: Record<Exclude<TargetKind, "tv_show">, MockItem[]> = { place: PLACES, movie: MOVIES, artist: ARTISTS };

// Registry of resolved inputs so insights() can read their vibes back.
const resolved = new Map<string, MockItem>();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function vibesFromText(text: string, kind: TasteKind): Vibe[] {
  const t = text.toLowerCase();
  const hits = VIBES.filter((v) => t.includes(v.replace("-", " ")) || t.includes(v));
  const bias = KIND_BIAS[kind];
  const h = hash(t + kind);
  const picks = new Set<Vibe>(hits);
  for (let i = 0; picks.size < 3 + (hits.length ? 0 : 1) && i < 8; i++) picks.add(bias[(h >>> (i * 3)) % bias.length]);
  return [...picks];
}

export function resolve(query: string, kind: TasteKind): Entity | null {
  const q = query.trim();
  if (!q) return null;
  const key = q.toLowerCase();
  const known = KNOWN[key] ?? (kind === "book" ? KNOWN[`${key} book`] : undefined);
  const base: EntityKind = kind;
  const item: MockItem = known && known.kind === kind
    ? { id: `mock-in-${slug(known.name)}-${kind}`, kind: known.as ?? base, name: known.name, subtitle: known.subtitle, vibes: known.vibes }
    : { id: `mock-in-${slug(q)}-${kind}`, kind: base, name: titleCase(q), vibes: vibesFromText(q, kind) };
  resolved.set(item.id, item);
  return strip(item);
}

function titleCase(s: string) {
  return s.replace(/\s+/g, " ").replace(/(^|\s)(\p{Ll})/gu, (_, a, b) => a + b.toUpperCase());
}

function strip(item: MockItem): Entity {
  const { vibes, role, ...e } = item;
  const tags = vibes.slice(0, 4).map((v) => v.replace("-", " "));
  if (item.kind !== "place") return { ...e, tags };
  const noise = vibes.includes("lively") || vibes.includes("energetic") ? "Loud" : vibes.includes("cozy") || vibes.includes("chill") ? "Quiet" : "Moderate";
  const dietary = vibes.includes("vegan") ? ["Vegan", "Vegetarian"] : /italian|asian|mexican/.test(vibes.join(" ")) ? ["Vegetarian"] : [];
  return {
    ...e,
    tags,
    facets: { categories: [e.subtitle ?? (role === "activity" ? "Bar" : "Restaurant"), role === "activity" ? "Bar" : "Restaurant"], noise, dietary, vibe: tags.slice(0, 2) },
  };
}

export function searchPlace(name: string, city: string): Entity | null {
  // The mock catalog only knows its own (fictional) venues; a name a plain LLM invents won't be found.
  const hit = PLACES.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) return null;
  const e = strip(hit);
  e.address = `Sample venue · ${city}`;
  return e;
}

const vibesOf = (ids: string[]) => ids.map((id) => resolved.get(id)).filter(Boolean).flatMap((m) => (m as MockItem).vibes);

export function tasteTags(ids: string[], take = 12): TagAffinity[] {
  const counts = new Map<string, number>();
  for (const v of vibesOf(ids)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, take)
    .map(([v, n]) => ({ id: `mock:tag:${v}`, name: v.replace("-", " "), subtype: "urn:tag:keyword:media", score: Number((0.6 + 0.4 * (n / max)).toFixed(3)) }));
}

export function compare(a: string[], b: string[], take = 12): TagAffinity[] {
  const va = new Set(vibesOf(a));
  const vb = vibesOf(b);
  const shared = [...new Set(vb.filter((v) => va.has(v)))];
  // when two tastes share nothing, fall back to the closest neighbours in the vibe list (still hand-made data)
  const out = shared.length ? shared : [...va].slice(0, 2);
  return out.slice(0, take).map((v, i) => ({ id: `mock:tag:${v}`, name: v.replace("-", " "), subtype: "urn:tag:keyword:media", score: Number((0.9 - i * 0.05).toFixed(3)) }));
}

// Mirrors the shape of Qloo /v2/tags ids so slot specs work identically in both modes.
const MOCK_TAGS: [RegExp, TagResult][] = [
  [/restaurant|dinner|food|eat/, { id: "urn:tag:category:place:restaurant", name: "Restaurant", type: "urn:tag:category:place" }],
  [/karaoke/, { id: "urn:tag:category:place:karaoke", name: "Karaoke", type: "urn:tag:category:place" }],
  [/jazz/, { id: "urn:tag:category:place:jazz_club", name: "Jazz club", type: "urn:tag:category:place" }],
  [/comedy/, { id: "urn:tag:category:place:comedy_club", name: "Comedy club", type: "urn:tag:category:place" }],
  [/live music|venue|gig|concert/, { id: "urn:tag:category:place:live_music_venue", name: "Live music venue", type: "urn:tag:category:place" }],
  [/cocktail/, { id: "urn:tag:category:place:cocktail_bar", name: "Cocktail bar", type: "urn:tag:category:place" }],
  [/club|dance|nightlife/, { id: "urn:tag:category:place:night_club", name: "Night club", type: "urn:tag:category:place" }],
  [/\bbar|pub|drinks/, { id: "urn:tag:category:place:bar", name: "Bar", type: "urn:tag:category:place" }],
  [/vegetarian/, { id: "urn:tag:dietary_option:qloo:vegetarian", name: "Vegetarian", type: "urn:tag:dietary_option:qloo" }],
  [/vegan/, { id: "urn:tag:dietary_option:qloo:vegan", name: "Vegan", type: "urn:tag:dietary_option:qloo" }],
  [/quiet/, { id: "urn:tag:noise_level:qloo:quiet", name: "Quiet", type: "urn:tag:noise_level:qloo" }],
  [/loud/, { id: "urn:tag:noise_level:qloo:loud", name: "Loud", type: "urn:tag:noise_level:qloo" }],
];

export function findTags(query: string): TagResult[] {
  const q = query.toLowerCase();
  return MOCK_TAGS.filter(([re]) => re.test(q)).map(([, t]) => t);
}

export function insights(opts: InsightOptions): InsightResult[] {
  const signals = opts.entityIds.map((id) => resolved.get(id)).filter(Boolean) as MockItem[];
  let pool = TARGETS[opts.type === "tv_show" ? "movie" : opts.type];
  if (opts.type === "place" && opts.tagIds?.length) {
    const wantRestaurant = opts.tagIds.some((t) => RESTAURANT_TAG.test(t));
    const wantActivity = opts.tagIds.some((t) => ACTIVITY_TAG.test(t));
    if (wantRestaurant || wantActivity) pool = pool.filter((p) => (wantRestaurant && p.role === "restaurant") || (wantActivity && p.role === "activity"));
  }
  if (opts.type === "place" && opts.priceMax) pool = pool.filter((p) => !p.priceLevel || p.priceLevel <= opts.priceMax!);
  if (opts.type === "place" && opts.excludeTagIds?.some((t) => /noise_level.*loud/.test(t))) pool = pool.filter((p) => strip(p).facets?.noise !== "Loud");
  if (opts.resultIds?.length) {
    const only = new Set(opts.resultIds);
    pool = pool.filter((p) => only.has(p.id));
  }
  const exclude = new Set(opts.excludeIds ?? []);
  const signalNames = new Set(signals.map((s) => s.name.toLowerCase()));
  const scored = pool
    .filter((c) => !exclude.has(c.id) && !signalNames.has(c.name.toLowerCase()))
    .map((c) => {
      const explain: Record<string, number> = {};
      let total = 0;
      for (const s of signals) {
        const overlap = c.vibes.filter((v) => s.vibes.includes(v)).length;
        const score = overlap / Math.sqrt(c.vibes.length * s.vibes.length);
        if (score > 0) explain[s.id] = Number(score.toFixed(3));
        total += score;
      }
      const jitter = ((hash(c.id + (opts.city ?? "")) % 1000) / 1000) * 0.06;
      const affinity = signals.length ? 1 - Math.exp(-(total * 2.2) / Math.sqrt(signals.length)) + jitter : jitter;
      return { c, affinity: Math.min(0.99, Number(affinity.toFixed(3))), explain };
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, opts.take ?? 20);

  return scored.map(({ c, affinity, explain }) => {
    const e = strip(c);
    if (c.kind === "place") e.address = `Sample venue · ${opts.city || "your city"}`;
    return { entity: e, affinity, explain };
  });
}
