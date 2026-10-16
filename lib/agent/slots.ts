// Itinerary slots: which Qloo query serves each one, and the category checks that
// keep a "dinner" from being a department store or a "bar" from being a wedding venue.
//
// Tag ids are Qloo place-category tags (urn:tag:category:place:*), confirmed with
// GET /v2/tags. Activity searches combine several with operator.filter.tags=union.

import type { Constraints, Entity, Slot, TargetKind } from "../types";

export interface SlotSpec {
  slot: Slot;
  target: TargetKind;
  label: string;
  tagIds?: string[];
  take: number;
}

const CAT = (s: string) => `urn:tag:category:place:${s}`;

export const ACTIVITY_TAGS = [
  "bar",
  "cocktail_bar",
  "wine_bar",
  "pub",
  "live_music_venue",
  "jazz_club",
  "karaoke",
  "comedy_club",
  "night_club",
  "brewery",
].map(CAT);

export const SLOT_SPECS: Record<Slot, SlotSpec> = {
  dinner: { slot: "dinner", target: "place", label: "dinner", tagIds: [CAT("restaurant")], take: 30 },
  activity: { slot: "activity", target: "place", label: "after-dinner plan", tagIds: ACTIVITY_TAGS, take: 30 },
  playlist: { slot: "playlist", target: "artist", label: "shared playlist", take: 16 },
  film: { slot: "film", target: "movie", label: "next movie night", take: 16 },
};

/** Known activity words → the Qloo category tag that serves them. */
export const ACTIVITY_WORDS: [RegExp, string][] = [
  [/karaoke/i, CAT("karaoke")],
  [/jazz/i, CAT("jazz_club")],
  [/comedy|stand.?up/i, CAT("comedy_club")],
  [/live music|gig|concert|band/i, CAT("live_music_venue")],
  [/cocktail/i, CAT("cocktail_bar")],
  [/wine/i, CAT("wine_bar")],
  [/dance|club|clubbing/i, CAT("night_club")],
  [/pub|beer|brew/i, CAT("pub")],
];

const DINNER_OK =
  /restaurant|bistro|brasserie|eatery|diner|steak|pizz|ramen|sushi|noodle|izakaya|trattoria|osteria|taquer|grill|bbq|barbecue|hot pot|food court|gastropub|tapas|kitchen|caf[eé]|bakery|deli|canteen|buffet|street food|food stall|night market|brewpub|pho|curry|dumpling|kebab|tavern|bodega|cafeteria|brunch|seafood|chophouse|yakitori|tonkatsu|udon|soba/i;
const ACTIVITY_OK =
  /\bbar\b|pub|club|lounge|venue|karaoke|speakeasy|brewery|brewpub|taproom|tavern|jazz|comedy|theat|cinema|bowling|arcade|concert|music|izakaya|beer garden|beer hall|rooftop|wine|cocktail|night market|gallery|live|dance|hall|biergarten|sake/i;
/** primary categories that are never a night out, whatever else they're tagged with */
const NEVER =
  /casino|scenic|observation|tourist attraction|museum|\bpark$|^garden$|botanical|zoo|aquarium|stadium|arena|wedding|funeral|banquet|department store|clothing|shoe|supermarket|grocery|shopping mall|\bmall\b|furniture|home goods|motel|apartment|bank|office|school|university|hospital|clinic|dentist|gym|fitness|salon|\bspa\b|barber|pharmacy|church|temple|pagoda|real estate|agency|parking|gas station|adult|tour operator|travel|pet |veterinar|car |laundry|airport|station|consulate|embassy/i;

/** Validate a place for a slot from its Qloo category tags. Returns a reason when rejected. */
const NOT_A_NIGHT_OUT_NAME = /universit|college|school|campus|hospital|clinic|airport|headquarters|office|ministry|embassy|cafeteria|canteen|food hall of|lobby|dormitor|student|\b(?:national|british|public|state|central|city|county|university) library\b|\bmuseum\b/i;
const STREET_FOOD = /night market|food court|street food|food stall|hawker|food market/i;

export function placeCheck(slot: Slot, e: Entity): string | null {
  if (e.kind !== "place") return null;
  if (NOT_A_NIGHT_OUT_NAME.test(e.name)) return "is part of a campus or institution";
  const cats = e.facets?.categories?.length ? e.facets.categories : e.subtitle ? [e.subtitle] : [];
  if (!cats.length) return "no category";
  if (NEVER.test(cats[0])) return `is a ${cats[0].toLowerCase()}`;
  const civic = cats.find((c) => /library|museum|universit|school|hospital|stadium|church|temple|government|bank/i.test(c));
  if (civic) return `is a ${civic.toLowerCase()}`;
  if (slot === "dinner") {
    if (!cats.some((c) => DINNER_OK.test(c))) return `is a ${cats[0].toLowerCase()}, not somewhere to eat`;
    // a cafeteria/canteen is only a night out when it's really a street-food market
    if (/cafeteria|canteen/i.test(cats[0]) && !cats.some((c) => STREET_FOOD.test(c))) return "is a cafeteria, not a group dinner";
    // a neighbourhood or landmark tagged "Restaurant" (e.g. a whole district) isn't a table for four
    const specific = cats.some((c) => DINNER_OK.test(c) && !/^restaurant$/i.test(c.trim()));
    if (!specific && cats.some((c) => /hotel|hostel|resort|lobby/i.test(c))) return "is a hotel, not a restaurant";
    if (!specific && cats.some((c) => /tourist attraction|neighbo|district|landmark|^market$|historical/i.test(c))) return "is a neighbourhood or landmark, not one restaurant";
    return null;
  }
  if (slot === "activity") {
    // hotels only count when Qloo tags an actual bar/lounge/club in them
    if (cats.some((c) => /hotel|lobby|hostel|resort/i.test(c)) && !cats.some((c) => /bar|lounge|club|pub|music|karaoke/i.test(c))) return "is a hotel, not a bar";
    if (/cafeteria|canteen|cafe|coffee/i.test(cats[0]) && !cats.some((c) => /bar|pub|club|music|karaoke|lounge/i.test(c))) return `is a ${cats[0].toLowerCase()}, not a night-out spot`;
    const ok = cats.some((c) => ACTIVITY_OK.test(c));
    return ok ? null : `is a ${cats[0].toLowerCase()}, not a bar, venue or show`;
  }
  return null;
}

/** Apply user constraints that Qloo can't filter on directly (it can for price and loud venues). */
export function constraintCheck(slot: Slot, e: Entity, c?: Constraints): string | null {
  if (!c || e.kind !== "place") return null;
  if (c.priceMax && e.priceLevel && e.priceLevel > c.priceMax) return `price level ${e.priceLevel} > ${c.priceMax}`;
  if (c.quiet && e.facets?.noise && /loud/i.test(e.facets.noise)) return "tagged loud";
  if (slot === "dinner" && c.dietary?.length) {
    const d = (e.facets?.dietary ?? []).join(" ").toLowerCase();
    const need = c.dietary.map((x) => x.toLowerCase());
    // vegan places satisfy vegetarian too
    const ok = need.every((n) => d.includes(n) || (n === "vegetarian" && d.includes("vegan")));
    if (!ok) return `no ${need.join("/")} options tagged`;
  }
  return null;
}

/** Qloo-side filters for the constraints (fewer wasted candidates). */
export function constraintParams(slot: Slot, c?: Constraints) {
  const out: { priceMax?: number; excludeTagIds?: string[] } = {};
  if (!c) return out;
  if (c.priceMax && (slot === "dinner" || slot === "activity")) out.priceMax = c.priceMax;
  if (c.quiet && (slot === "dinner" || slot === "activity")) out.excludeTagIds = ["urn:tag:noise_level:qloo:loud"];
  return out;
}
