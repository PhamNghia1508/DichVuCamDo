// Shared types for TasteCircle.

export type TasteKind = "artist" | "movie" | "place" | "book";
export type TargetKind = "place" | "movie" | "artist";

export const KIND_URN: Record<TasteKind, string> = {
  artist: "urn:entity:artist",
  movie: "urn:entity:movie",
  place: "urn:entity:place",
  book: "urn:entity:book",
};

export const KIND_LABEL: Record<TasteKind, string> = {
  artist: "Artists",
  movie: "Movies",
  place: "Restaurants & spots",
  book: "Books",
};

export interface MemberInput {
  name: string;
  tastes: Record<TasteKind, string[]>;
}

export interface PlanRequest {
  members: MemberInput[];
  city: string;
  vibe?: string;
}

/** An entity as TasteCircle uses it (a thin projection of a Qloo entity). */
export interface Entity {
  id: string;
  name: string;
  kind: TasteKind;
  subtitle?: string;
  address?: string;
  image?: string;
  tags?: string[];
  priceLevel?: number;
  rating?: number;
  url?: string;
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

/** One recommendation candidate scored for the whole group. */
export interface Candidate {
  entity: Entity;
  /** Affinity from the all-members signal call (0..1). */
  groupAffinity: number;
  /** Affinity per member name (0..1); 0 = not in that member's list. */
  memberAffinity: Record<string, number>;
  /** Consensus = blend of group affinity and harmonic mean of member affinities. */
  consensus: number;
  /** Fairness = least-happy member / happiest member (0..1). */
  fairness: number;
  /** Which input tastes pushed this pick up, grouped by member. */
  drivers: Record<string, string[]>;
}

export interface ItineraryStop {
  slot: "dinner" | "activity" | "playlist" | "film";
  title: string;
  time?: string;
  entity?: Entity;
  entities?: Entity[];
  blurb: string;
  whyByMember: Record<string, string>;
  consensus?: number;
  fairness?: number;
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
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "tool_start"; id: string; tool: string; label: string; args?: unknown }
  | { type: "tool_end"; id: string; tool: string; summary: string; ok: boolean }
  | { type: "thought"; text: string }
  | { type: "plan"; plan: Plan }
  | { type: "error"; message: string };
