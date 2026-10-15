import type { ReactNode } from "react";

export const MEMBER_COLORS = ["#ff5b3a", "#6b5cff", "#0fa39a", "#f2a516", "#e8488a", "#2f7bf5", "#7a8f2b", "#a0522d"];
export const colorFor = (i: number) => MEMBER_COLORS[i % MEMBER_COLORS.length];

export function Avatar({ name, i, title }: { name: string; i: number; title?: string }) {
  const initials = name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <span className="avatar" style={{ background: colorFor(i) }} title={title ?? name} aria-hidden>
      {initials}
    </span>
  );
}

const S = (p: { children: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {p.children}
  </svg>
);

export const Icon = {
  dinner: () => (
    <S>
      <path d="M4 11h16a8 8 0 0 1-16 0Z" />
      <path d="M8 4c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3M16 4c0 1.5 1 1.5 1 3" />
    </S>
  ),
  activity: () => (
    <S>
      <path d="M12 3l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 15.4 7 18.2l1.2-5.6L4 8.8l5.6-.6Z" />
    </S>
  ),
  playlist: () => (
    <S>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </S>
  ),
  film: () => (
    <S>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M3 15h18M8 5v4M16 5v4M8 15v4M16 15v4" />
    </S>
  ),
  artist: () => (
    <S>
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </S>
  ),
  movie: () => (
    <S>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.5v5l4-2.5Z" />
    </S>
  ),
  place: () => (
    <S>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </S>
  ),
  book: () => (
    <S>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z" />
      <path d="M4 19V5M8 7h7" />
    </S>
  ),
};
