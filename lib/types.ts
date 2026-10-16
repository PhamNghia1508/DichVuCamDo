// Shared types for TasteCircle.

/** The four input rows a friend fills in. Each row searches several Qloo entity types. */
export type TasteKind = "artist" | "movie" | "place" | "book";
/** Qloo entity types TasteCircle reads or recommends. */
export type EntityKind = "artist" | "movie" | "tv_show" | "book" | "podcast" | "place";
export type TargetKind = "place" | "movie" | "artist" | "tv_show";

export const ENTITY_URN: Record<EntityKind, string> = {
  artist: "urn:entity:artist",
  movie: "urn:entity:movie",
  tv_show: "urn:entity:tv_show",
  book: "urn:entity:book",
  podcast: "urn:entity:podcast",
  place: "urn:entity:place",
};

/** Which Qloo types each input row searches (cross-domain: one row, several types). */
export const KIND_SEARCH: Record<TasteKind, EntityKind[]> = {
  artist: ["artist"],
  movie: ["movie", "tv_show"],
  book: ["book", "podcast"],
  place: ["place"],
};

export const KIND_LABEL: Record<TasteKind, string> = {
  artist: "Music",
  movie: "Film & TV",
  book: "Books & podcasts",
  place: "Food & places",
};

export interface MemberInput {
  name: string;
  tastes: Record<TasteKind, string[]>;
}

export interface Constraints {
  /** Qloo price_level 1–4 */
  priceMax?: number;
  quiet?: boolean;
  /** e.g. ["vegetarian"], with the members who need it */
  dietary?: string[];
  dietaryFor?: string[];
  /** free words to steer the activity type, e.g. "karaoke", "jazz" */
  activity?: string;
}

export interface PlanRequest {
  members: MemberInput[];
  city: string;
  vibe?: string;
  constraints?: Constraints;
}

export interface Facets {
  categories?: string[];
  dietary?: string[];
  noise?: string;
  vibe?: string[];
  cuisine?: string[];
}

/** An entity as TasteCircle uses it (a thin projection of a Qloo entity). */
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  subtitle?: string;
  address?: string;
  neighborhood?: string;
  image?: string;
  tags?: string[];
  priceLevel?: number;
  rating?: number;
  url?: string;
  popularity?: number;
  facets?: Facets;
}

export interface ResolvedTaste {
  input: string;
  kind: TasteKind;
  entity: Entity | null;
}

export interface ResolvedMember {
  name: string;
  tastes: ResolvedTaste[];
}

/** A member's favourite that Qloo's explainability credits for a pick. */
export interface Driver {
  name: string;
  kind: EntityKind;
  /** share of this member's explain weight (0..1) */
  weight: number;
}

/** One recommendation candidate scored for the whole group. */
export interface Candidate {
  entity: Entity;
  /** Raw Qloo affinity from the all-members signal call (0..1). */
  groupAffinity: number;
  /** Raw Qloo affinity per member (that member's signal alone). */
  memberRaw: Record<string, number>;
  /** Taste fit per member: raw affinity rescaled within the candidate pool for that member (0..1). */
  memberAffinity: Record<string, number>;
  /** consensus = 0.45·groupFit + 0.55·harmonicMean(memberFit) */
  consensus: number;
  /** fairness = least-happy member / happiest member (0..1) */
  fairness: number;
  /** The member's own favourites Qloo explainability credits for this pick (strongest first). */
  drivers: Record<string, Driver[]>;
  /** How much the group signal leans on each member (1 = their fair share of inputs). */
  lean: Record<string, number>;
  /** set when the candidate came from a bridge search seeded by this member */
  bridgeFor?: string;
}

export type Slot = "dinner" | "activity" | "playlist" | "film";

export interface ItineraryStop {
  slot: Slot;
  title: string;
  time?: string;
  entity?: Entity;
  entities?: Entity[];
  blurb: string;
  whyByMember: Record<string, string>;
  consensus?: number;
  fairness?: number;
  /** taste fit per member, 0..1 */
  memberScores?: Record<string, number>;
  /** top driving favourite per member (only where explainability gives real weight) */
  drivers?: Record<string, Driver[]>;
  bridgeFor?: string;
  /** raw Qloo affinity per member (for the LLM-vs-Qloo comparison) */
  memberRaw?: Record<string, number>;
}

export interface TasteTag {
  name: string;
  kind: string;
  weight: number;
}

export interface TasteMap {
  members: { name: string; tags: TasteTag[]; likes: string[] }[];
  /** tags at least two members share, strongest first */
  shared: { name: string; members: string[]; weight: number }[];
  pairs: { a: string; b: string; similarity: number }[];
  /** the two furthest-apart members and what Qloo's compare says connects them */
  bridge?: { a: string; b: string; tags: string[] };
}

/** Minimal per-member state carried with a plan so it can be refined without re-resolving tastes. */
export interface CircleMember {
  name: string;
  likes: { id: string; name: string; kind: EntityKind }[];
}

export interface Plan {
  title: string;
  summary: string;
  city: string;
  vibe?: string;
  members: string[];
  stops: ItineraryStop[];
  mode: { qloo: "live" | "mock"; planner: "llm" | "deterministic"; model?: string };
  createdAt: string;
  circle?: CircleMember[];
  constraints?: Constraints;
  tasteMap?: TasteMap;
  /** per slot, per member: [min, max] raw affinity across the pool Qloo surfaced (fit scale) */
  ranges?: Partial<Record<Slot, Record<string, [number, number]>>>;
  /** what the agent's critic flagged and how it was resolved */
  critiques?: string[];
  /** refinement history, newest last */
  changes?: string[];
  stats?: { qlooCalls: number; llmTurns: number; ms: number };
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "tool_start"; id: string; tool: string; label: string; args?: unknown }
  | { type: "tool_end"; id: string; tool: string; summary: string; ok: boolean }
  | { type: "thought"; text: string }
  | { type: "critique"; text: string }
  | { type: "taste_map"; map: TasteMap }
  | { type: "plan"; plan: Plan }
  | { type: "error"; message: string };

export interface BaselinePick {
  slot: Slot;
  name: string;
  /** what the plain LLM said about it */
  note?: string;
  /** Qloo /search match, if any */
  found?: { id: string; name: string; address?: string; categories?: string[] };
  memberScores?: Record<string, number>;
  consensus?: number;
  fairness?: number;
  /** true when Qloo couldn't find this place (in that city) at all */
  unverified?: boolean;
  /** Qloo knows a place by that name, but not in this city */
  elsewhere?: string;
  /** the LLM just handed back one of this member's own favourites */
  echo?: string;
  /** playlist: artists the LLM handed back that someone already entered */
  echoes?: string[];
}

export interface BaselineResult {
  model: string;
  picks: BaselinePick[];
  ms: number;
}
