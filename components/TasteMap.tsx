"use client";
import type { Plan, TasteMap as Map } from "@/lib/types";
import { colorFor } from "./ui";

const pct = (n: number) => Math.round(n * 100);
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

function verdict(map: Map) {
  const sims = map.pairs.map((p) => p.similarity);
  const avg = sims.reduce((s, x) => s + x, 0) / Math.max(1, sims.length);
  if (avg < 0.06) return { h: "On paper, this circle shouldn’t work.", s: "Almost no taste overlap — which is exactly when a planner that averages people out fails." };
  if (avg < 0.18) return { h: "Different tastes, a few quiet overlaps.", s: "Not much in common on the surface. The overlaps below are what tonight is built on." };
  return { h: "More in common than you’d think.", s: "A circle with real shared ground — the job is keeping everyone’s edge in the plan." };
}

/** The circle's taste map: fingerprints per member from Qloo taste analysis, pairwise overlap, and the bridge Qloo’s compare finds. */
export function TasteMap({ map, compact = false, plan }: { map: Map; compact?: boolean; plan?: Plan | null }) {
  const n = map.members.length;
  const W = 640;
  const H = compact ? 300 : 380;
  const cx = W / 2;
  const cy = H / 2;
  const rx = compact ? 210 : 230;
  const ry = compact ? 100 : 128;
  const pos = map.members.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0);
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  const idx = (name: string) => map.members.findIndex((m) => m.name === name);
  const v = verdict(map);
  const bridgeWords = map.bridge?.tags.slice(0, 3) ?? map.shared.slice(0, 3).map((s) => s.name);
  // per-member "pull" on the final plan: average taste fit across stops
  const pull = plan
    ? Object.fromEntries(
        plan.members.map((m) => {
          const vals = plan.stops.map((s) => s.memberScores?.[m]).filter((x): x is number => typeof x === "number");
          return [m, vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0];
        }),
      )
    : null;

  return (
    <section className={`tmap ${compact ? "is-compact" : ""}`} aria-label="Your circle’s taste map">
      <div className="tmap-head">
        <span className="mono tmap-kicker">Your circle, decoded · Qloo taste analysis</span>
        <h3>{v.h}</h3>
        {!compact && <p>{v.s}</p>}
      </div>

      <div className="tmap-stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Taste overlap between ${map.members.map((m) => m.name).join(", ")}`}>
          {map.pairs.map((p, k) => {
            const a = pos[idx(p.a)];
            const b = pos[idx(p.b)];
            if (!a || !b) return null;
            const far = map.bridge && ((map.bridge.a === p.a && map.bridge.b === p.b) || (map.bridge.a === p.b && map.bridge.b === p.a));
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={k} className={`tm-edge ${far ? "far" : ""}`} style={{ animationDelay: `${0.35 + k * 0.12}s` }}>
                <path d={`M${a.x} ${a.y} Q ${(mx + cx) / 2} ${(my + cy) / 2} ${b.x} ${b.y}`} style={{ strokeWidth: 1 + p.similarity * 16 }} pathLength={1} />
                <text x={(mx * 3 + cx) / 4} y={(my * 3 + cy) / 4 + 4} textAnchor="middle">
                  {pct(p.similarity)}%
                </text>
              </g>
            );
          })}
          <g className="tm-hub">
            <circle cx={cx} cy={cy} r={compact ? 30 : 38} />
            <text x={cx} y={cy - 3} textAnchor="middle" className="tm-hub-k">
              meet on
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="tm-hub-v">
              {(bridgeWords[0] ?? "—").slice(0, 14)}
            </text>
          </g>
          {map.members.map((m, i) => (
            <g key={m.name} className="tm-node" style={{ ["--m" as string]: colorFor(i), animationDelay: `${i * 0.12}s` }}>
              <circle cx={pos[i].x} cy={pos[i].y} r={compact ? 24 : 30} />
              <text x={pos[i].x} y={pos[i].y + 5} textAnchor="middle" className="tm-ini">
                {initials(m.name)}
              </text>
              <text x={pos[i].x} y={pos[i].y + (pos[i].y > cy ? 50 : -40)} textAnchor="middle" className="tm-name">
                {m.name}
              </text>
              {!compact && m.tags[0] && (
                <text x={pos[i].x} y={pos[i].y + (pos[i].y > cy ? 66 : -58)} textAnchor="middle" className="tm-tag">
                  {m.tags
                    .slice(0, 2)
                    .map((t) => t.name.toLowerCase())
                    .join(" · ")}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {map.bridge && (
        <p className="tmap-bridge">
          <b>{map.bridge.a}</b> and <b>{map.bridge.b}</b> are furthest apart. Qloo’s compare finds them meeting on{" "}
          {map.bridge.tags.slice(0, 3).map((t, i) => (
            <span key={t}>
              <em>{t}</em>
              {i < Math.min(2, map.bridge!.tags.length - 1) ? ", " : ""}
            </span>
          ))}
          {" "}— that’s where the plan leans.
        </p>
      )}

      {!compact && (
        <ol className="tmap-prints">
          {map.members.map((m, i) => (
            <li key={m.name} style={{ ["--m" as string]: colorFor(i) }}>
              <div className="tp-name">
                <span className="tp-dot" /> {m.name}
                {pull && <span className="tp-pull mono">{pct(pull[m.name] ?? 0)} avg fit tonight</span>}
              </div>
              <ul className="tp-tags">
                {m.tags.slice(0, 5).map((t) => (
                  <li key={t.name}>
                    <span>{t.name}</span>
                    <span className="mono">{t.kind}</span>
                  </li>
                ))}
              </ul>
              <p className="tp-likes">from {m.likes.slice(0, 4).join(", ")}</p>
            </li>
          ))}
        </ol>
      )}
      {!compact && map.shared.length > 0 && (
        <div className="tmap-shared">
          <span className="mono">Shared ground</span>
          <ul>
            {map.shared.slice(0, 6).map((s) => (
              <li key={s.name}>
                {s.name}
                <span className="sh-dots">
                  {s.members.map((m) => (
                    <i key={m} style={{ background: colorFor(idx(m)) }} title={m} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
