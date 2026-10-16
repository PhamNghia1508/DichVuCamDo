"use client";
import { useState } from "react";
import type { Entity, ItineraryStop, Plan } from "@/lib/types";
import { BASE_PATH, IS_STATIC_DEMO, encodePlan } from "@/lib/client";
import { Avatar, Icon, colorFor } from "./ui";

const pct = (n?: number) => Math.round((n ?? 0) * 100);
const price = (n?: number) => (n ? "$".repeat(n) : null);
const okImg = (src?: string) => !!src && /^https:\/\//.test(src);

function mapsUrl(e: Entity, city: string) {
  const q = encodeURIComponent(`${e.name} ${e.address && !e.address.startsWith("Sample") ? e.address : city}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Qloo entity image with a typographic fallback (initial on a tinted card). */
function Cover({ e, i = 0, className = "" }: { e: Entity; i?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (okImg(e.image) && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`cover ${className}`} src={e.image} alt={e.name} loading="eager" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    );
  return (
    <span className={`cover cover-fallback ${className}`} style={{ ["--m" as string]: colorFor(i + 1) }} aria-hidden>
      {e.name.replace(/^the\s+/i, "")[0]}
    </span>
  );
}

function Score({ stop }: { stop: ItineraryStop }) {
  if (stop.consensus === undefined) return null;
  return (
    <div className="score">
      <div className="score-num">
        <span className="big">{pct(stop.consensus)}</span>
        <span className="mono">% group
          <br />
          consensus</span>
      </div>
      <div className="score-fair">
        <div className="score-fair-top mono">
          <span>Fairness</span>
          <span>{pct(stop.fairness)}%</span>
        </div>
        <div className="bar">
          <i style={{ width: `${pct(stop.fairness)}%` }} />
        </div>
      </div>
    </div>
  );
}

function Whys({ stop, plan }: { stop: ItineraryStop; plan: Plan }) {
  return (
    <ul className="whys">
      {plan.members.map((m, i) =>
        stop.whyByMember[m] ? (
          <li className="why" key={m} style={{ ["--m" as string]: colorFor(i) }}>
            <Avatar name={m} i={i} />
            <p>
              <b>{m}</b> {stop.whyByMember[m]}
            </p>
          </li>
        ) : null,
      )}
    </ul>
  );
}

function Stop({ stop, plan, n }: { stop: ItineraryStop; plan: Plan; n: number }) {
  const I = Icon[stop.slot];
  const e = stop.entity;
  return (
    <li className={`stop slot-${stop.slot}`} style={{ animationDelay: `${n * 90}ms` }}>
      <div className="stop-rail">
        <span className="stop-n mono">{String(n + 1).padStart(2, "0")}</span>
        <span className="stop-time mono">{stop.time ?? (stop.slot === "playlist" ? "On the way" : "Later")}</span>
        <span className="stop-kicker">
          <I /> {stop.title}
        </span>
      </div>
      <div className="stop-body">
        {e && (
          <div className="stop-main">
            <Cover e={e} i={n} className="stop-cover" />
            <div className="stop-text">
              <h3>{e.name}</h3>
              <div className="stop-sub mono">
                {e.subtitle && <span>{e.subtitle}</span>}
                {price(e.priceLevel) && <span>{price(e.priceLevel)}</span>}
                {e.rating && <span>★ {e.rating.toFixed(1)}</span>}
                {e.kind === "place" && (
                  <a href={mapsUrl(e, plan.city)} target="_blank" rel="noreferrer">
                    Maps ↗
                  </a>
                )}
              </div>
              <p className="stop-blurb">{stop.blurb}</p>
              <Score stop={stop} />
            </div>
          </div>
        )}
        {stop.entities && (
          <>
            <div className="stop-text">
              <h3>
                {stop.entities.length} artists you all share
              </h3>
              <p className="stop-blurb">{stop.blurb}</p>
            </div>
            <div className="artists">
              {stop.entities.map((a, i) => (
                <a key={a.id} className="artist" href={`https://open.spotify.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer">
                  <Cover e={a} i={i + 2} className="artist-cover" />
                  <span className="an">{a.name}</span>
                  {a.subtitle && <span className="as mono">{a.subtitle}</span>}
                </a>
              ))}
            </div>
            <Score stop={stop} />
          </>
        )}
        <Whys stop={stop} plan={plan} />
      </div>
    </li>
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
  const live = plan.mode.qloo === "live";
  return (
    <article className="prog">
      <header className="prog-head">
        <div className="prog-meta mono">
          <span>{plan.city}</span>
          <span>{plan.members.length} people</span>
          {plan.vibe && <span>{plan.vibe}</span>}
          <span className={`tag ${live ? "live" : ""}`}>
            {live ? "Qloo live" : "Sample data"} · {plan.mode.planner === "llm" ? plan.mode.model : "rule-based planner"}
          </span>
        </div>
        <h2>{plan.title}</h2>
        <p className="prog-sum">{plan.summary}</p>
        <div className="faces">
          {plan.members.map((m, i) => (
            <span className="face" key={m}>
              <Avatar name={m} i={i} />
              <span>{m}</span>
            </span>
          ))}
        </div>
      </header>
      <ol className="stops">
        {plan.stops.map((s, n) => (
          <Stop key={s.slot} stop={s} plan={plan} n={n} />
        ))}
      </ol>
      <div className="prog-actions">
        <button className="btn btn-signal btn-sm" onClick={share}>
          Share itinerary <span className="arr" aria-hidden>↗</span>
        </button>
        <button
          className="btn btn-line btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(planAsText(plan));
            flash("Copied as text");
          }}
        >
          Copy as text
        </button>
        <button className="btn btn-line btn-sm" onClick={() => window.print()}>
          Print / PDF
        </button>
        {shared && (
          <a className="btn btn-ink btn-sm" href={`${BASE_PATH}/`}>
            Plan your own night <span className="arr" aria-hidden>→</span>
          </a>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </article>
  );
}

export function ItinerarySkeleton() {
  return (
    <div className="prog prog-skel" aria-hidden>
      <div className="prog-head">
        <div className="sk sk-meta" />
        <div className="sk sk-title" />
        <div className="sk sk-line" />
        <div className="sk sk-line short" />
      </div>
      <div className="stops">
        {[0, 1, 2].map((i) => (
          <div className="stop" key={i}>
            <div className="stop-rail">
              <div className="sk sk-chip" />
            </div>
            <div className="stop-main">
              <div className="sk sk-cover" />
              <div className="stop-text">
                <div className="sk sk-h" />
                <div className="sk sk-line" />
                <div className="sk sk-line short" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="skel-note mono">Drawing up your circle’s programme…</p>
    </div>
  );
}
