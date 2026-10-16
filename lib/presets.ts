// Sample circles: real-sounding friend groups whose tastes genuinely clash,
// chosen so every favourite resolves in Qloo and every city has venue data.
import type { MemberInput } from "./types";

export interface Preset {
  id: string;
  city: string;
  vibe: string;
  blurb: string;
  members: MemberInput[];
}

const m = (name: string, artist: string[], movie: string[], book: string[] = [], place: string[] = []): MemberInput => ({
  name,
  tastes: { artist, movie, book, place },
});

export const PRESETS: Preset[] = [
  {
    id: "nyc",
    city: "New York",
    vibe: "Friday night, mid-budget",
    blurb: "Sad indie vs. West Coast rap vs. Swiftie",
    members: [
      m("Maya", ["Radiohead", "Phoebe Bridgers"], ["Lost in Translation", "Fleabag"], ["Normal People"]),
      m("Jordan", ["Kendrick Lamar", "Anderson .Paak"], ["Moonlight"], ["Drink Champs"]),
      m("Priya", ["Taylor Swift"], ["Mamma Mia!", "The Bear"], ["Beach Read"]),
    ],
  },
  {
    id: "london",
    city: "London",
    vibe: "birthday drinks, not too posh",
    blurb: "Britpop lad, grime head, rom-com devotee",
    members: [
      m("Ollie", ["Arctic Monkeys", "The Smiths"], ["Trainspotting", "Peep Show"]),
      m("Amara", ["Little Simz", "Sade"], ["Get Out", "I May Destroy You"]),
      m("Freya", ["ABBA", "Charli XCX"], ["Bridget Jones's Diary"], ["Pride and Prejudice"]),
    ],
  },
  {
    id: "tokyo",
    city: "Tokyo",
    vibe: "first night in town",
    blurb: "Ambient purist, K-pop stan, synthwave nerd",
    members: [
      m("Ren", ["Ryuichi Sakamoto", "Nujabes"], ["Perfect Days"], ["Norwegian Wood"]),
      m("Sofia", ["BLACKPINK", "Dua Lipa"], ["Your Name"]),
      m("Leo", ["Daft Punk", "Justice"], ["Drive", "Blade Runner 2049"], ["Dune"]),
    ],
  },
  {
    id: "hcmc",
    city: "Ho Chi Minh City",
    vibe: "chill Friday, not too pricey",
    blurb: "Radiohead & rap Việt, jazz-pop, hip-hop & Ghibli",
    members: [
      m("Gô", ["Radiohead", "Đen Vâu"], ["Interstellar"], ["Norwegian Wood"], ["ramen"]),
      m("Linh", ["Taylor Swift", "Norah Jones"], ["La La Land"], ["The Little Prince"], ["pizza"]),
      m("Minh", ["Kendrick Lamar", "Daft Punk"], ["Spirited Away"], [], ["tacos"]),
    ],
  },
];
