"use client";
import { useState } from "react";
import type { Entity, ItineraryStop, Plan } from "@/lib/types";
import { BASE_PATH, IS_STATIC_DEMO, encodePlan } from "@/lib/client";
import { Avatar, Icon, colorFor } from "./ui";

const TINT: Record<ItineraryStop["slot"], [string, string]> = {
  dinner: ["#ffe7e0", "#c2381b"],
  activity: ["#ebe8ff", "#4b3df0"],
  playlist: ["#dcf5f2", "#08756e"],
  film: ["#fff1d6", "#a66b00"],
};

const pct = (n?: number) => Math.round((n ?? 0) * 100);
const price = (n?: number) => (n ? "$".repeat(n) : null);

function mapsUrl(e: Entity, city: string) {
  const q = encodeURIComponent(`${e.name} ${e.address && !e.address.startsWith("Sample") ? e.address : city}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function Stop({ stop, plan }: { stop: ItineraryStop; plan: Plan }) {
  const I = Icon[stop.slot];
  const [bg, fg] = TINT[stop.slot];
  const e = stop.entity;
  return (
    <div className="stop">
      <div className="stop-rail">
        <div className="stop-icon" style={{ background: bg, color: fg }}>
          <I />
        </div>
        {stop.time && <div className="stop-time">{stop.time}</div>}
      </div>
      <div>
        <div className="stop-kicker">{stop.title}</div>
        {e && (
          <>
            <h3>{e.name}</h3>
            <div className="stop-sub">
              {e.subtitle && <span>{e.subtitle}</span>}
              {price(e.priceLevel) && <span>· {price(e.priceLevel)}</span>}
              {e.rating && <span>· ★ {e.rating.toFixed(1)}</span>}
              {e.kind === "place" && (
                <span>
                  ·{" "}
                  <a href={mapsUrl(e, plan.city)} target="_blank" rel="noreferrer">
                    Open in Maps ↗
                  </a>
                </span>
              )}
            </div>
            {e.image && /^https:\/\//.test(e.image) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb" src={e.image} alt="" loading="lazy" />
            )}
          </>
        )}
        {stop.entities && (
          <>
            <h3>{stop.entities.length} artists you all share</h3>
            <div className="artists">
              {stop.entities.map((a, i) => (
                <a
                  key={a.id}
                  className="artist"
                  href={`https://open.spotify.com/search/${encodeURIComponent(a.name)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="art" style={a.image ? { backgroundImage: `url(${a.image})` } : { background: colorFor(i + 2) }}>
                    {a.image ? "" : a.name[0]}
                  </span>
                  <span>
                    <div className="an">{a.name}</div>
                    {a.subtitle && <div className="as">{a.subtitle}</div>}
                  </span>
                </a>
              ))}
            </div>
          </>
        )}
        <p className="stop-blurb">{stop.blurb}</p>
        {stop.consensus !== undefined && (
          <div className="scores">
            <div className="score">
              <div className="score-top">
                <span>Group consensus</span>
                <span>{pct(stop.consensus)}%</span>
              </div>
              <div className="bar">
                <i style={{ width: `${pct(stop.consensus)}%`, background: fg }} />
              </div>
            </div>
            <div className="score">
              <div className="score-top">
                <span>Fairness</span>
                <span>{pct(stop.fairness)}%</span>
              </div>
              <div className="bar">
                <i style={{ width: `${pct(stop.fairness)}%` }} />
              </div>
            </div>
          </div>
        )}
        <div className="whys">
          {plan.members.map((m, i) =>
            stop.whyByMember[m] ? (
              <div className="why" key={m}>
                <Avatar name={m} i={i} />
                <div>
                  <b>{m}</b> — {stop.whyByMember[m]}
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

export function planAsText(plan: Plan) {
  const lines = [`${plan.title} — ${plan.city}`, plan.summary, ""];
  for (const s of plan.stops) {
    const what = s.entity ? s.entity.name : (s.entities ?? []).map((e) => e.name).join(", ");
    lines.push(`${s.time ? s.time + " · " : ""}${s.title}: ${what}`);
    lines.push(`  ${s.blurb}`);
  }
  lines.push("", "Planned with TasteCircle (powered by Qloo Taste AI)");
  return lines.join("\n");
}

export function Itinerary({ plan, shared = false }: { plan: Plan; shared?: boolean }) {
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1800);
  };
  const shareLink = () => `${window.location.origin}${BASE_PATH}/plan${IS_STATIC_DEMO ? "/" : ""}#${encodePlan(plan)}`;
  const share = async () => {
    const url = shareLink();
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ title: plan.title, text: plan.summary, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("Share link copied");
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <article className="itin">
      <header className="itin-head">
        <div className="itin-meta">
          <span className="pill">{plan.city}</span>
          <span className="pill">{plan.members.length} people</span>
          {plan.vibe && <span className="pill">{plan.vibe}</span>}
          <span className="pill">
            Qloo {plan.mode.qloo === "live" ? "live" : "sample data"} · {plan.mode.planner === "llm" ? plan.mode.model : "rule-based planner"}
          </span>
        </div>
        <h2>{plan.title}</h2>
        <p className="itin-sum">{plan.summary}</p>
        <div className="faces">
          {plan.members.map((m, i) => (
            <Avatar key={m} name={m} i={i} />
          ))}
        </div>
      </header>
      <div className="stops">
        {plan.stops.map((s) => (
          <Stop key={s.slot} stop={s} plan={plan} />
        ))}
      </div>
      <div className="itin-actions">
        <button className="btn btn-accent btn-sm" onClick={share}>
          Share itinerary
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(planAsText(plan));
            flash("Copied as text");
          }}
        >
          Copy as text
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          Print / PDF
        </button>
        {shared && (
          <a className="btn btn-primary btn-sm" href={`${BASE_PATH}/`}>
            Plan your own night →
          </a>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </article>
  );
}
