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
export function Cover({ e, i = 0, className = "" }: { e: Entity; i?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (okImg(e.image) && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`cover ${className}`} src={e.image} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    );
  return (
    <span className={`cover cover-fallback ${className}`} style={{ ["--m" as string]: colorFor(i + 1) }} aria-hidden>
      {e.name.replace(/^the\s+/i, "")[0]}
    </span>
  );
}

/** Per-member taste fit with the favourite Qloo's explainability credits. The signature read of every stop. */
function FitStrip({ stop, plan }: { stop: ItineraryStop; plan: Plan }) {
  if (!stop.memberScores) return null;
  const min = Math.min(...plan.members.map((m) => stop.memberScores?.[m] ?? 0));
  return (
    <div className="fit">
      <div className="fit-head mono">
        <span>
          <b>{pct(stop.consensus)}</b> consensus
        </span>
        <span>
          <b>{pct(stop.fairness)}</b> fairness
        </span>
        {stop.bridgeFor && <span className="fit-bridge">Bridge pick for {stop.bridgeFor}</span>}
      </div>
      <ul className="fit-rows">
        {plan.members.map((m, i) => {
          const v = stop.memberScores?.[m] ?? 0;
          const d = stop.drivers?.[m]?.[0];
          return (
            <li key={m} className={`fit-row ${v === min && plan.members.length > 2 ? "low" : ""}`} style={{ ["--m" as string]: colorFor(i), ["--v" as string]: `${Math.max(3, pct(v))}%` }}>
              <Avatar name={m} i={i} />
              <span className="fit-name">{m}</span>
              <span className="fit-bar" aria-hidden>
                <i />
              </span>
              <span className="fit-num mono">{pct(v)}</span>
              <span className="fit-why">{d ? <>via {d.name}</> : <em>stretch pick</em>}</span>
            </li>
          );
        })}
      </ul>
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

function Stop({ stop, plan, n, changed }: { stop: ItineraryStop; plan: Plan; n: number; changed: boolean }) {
  const I = Icon[stop.slot];
  const e = stop.entity;
  return (
    <li className={`stop slot-${stop.slot} ${changed ? "is-changed" : ""}`} style={{ animationDelay: `${n * 90}ms` }}>
      <div className="stop-rail">
        <span className="stop-n mono">{String(n + 1).padStart(2, "0")}</span>
        <span className="stop-time mono">{stop.time ?? (stop.slot === "playlist" ? "On the way" : "Another night")}</span>
        <span className="stop-kicker">
          <I /> {stop.title}
        </span>
        {changed && <span className="stop-new mono">Updated</span>}
      </div>
      <div className="stop-body">
        {e && (
          <div className="stop-main">
            <Cover e={e} i={n} className="stop-cover" />
            <div className="stop-text">
              <h3>{e.name}</h3>
              <div className="stop-sub mono">
                {e.subtitle && <span>{e.subtitle}</span>}
                {e.neighborhood && <span>{e.neighborhood}</span>}
                {price(e.priceLevel) && <span>{price(e.priceLevel)}</span>}
                {e.facets?.noise && <span>{e.facets.noise} room</span>}
                {e.kind === "place" && (
                  <a href={mapsUrl(e, plan.city)} target="_blank" rel="noreferrer">
                    Maps ↗
                  </a>
                )}
              </div>
              <p className="stop-blurb">{stop.blurb}</p>
            </div>
          </div>
        )}
        {e && <FitStrip stop={stop} plan={plan} />}
        {stop.entities && (
          <>
            <div className="stop-text">
              <h3>{stop.entities.length} artists between you</h3>
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
            <FitStrip stop={stop} plan={plan} />
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
  lines.push("", "Planned with TasteCircle · taste data by Qloo");
  return lines.join("\n");
}

export function Itinerary({ plan, previous, shared = false, footer }: { plan: Plan; previous?: Plan | null; shared?: boolean; footer?: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1800);
  };
  const share = async () => {
    const url = `${window.location.origin}${BASE_PATH}/plan${IS_STATIC_DEMO ? "/" : ""}#${await encodePlan(plan)}`;
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ title: plan.title, text: plan.summary, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("Link copied — paste it in the group chat");
      }
    } catch {
      /* cancelled */
    }
  };
  const live = plan.mode.qloo === "live";
  const changedSlot = (s: ItineraryStop) => {
    if (!previous) return false;
    const p = previous.stops.find((x) => x.slot === s.slot);
    if (!p) return true;
    return (p.entity?.id ?? p.entities?.map((e) => e.id).join()) !== (s.entity?.id ?? s.entities?.map((e) => e.id).join());
  };
  const lastChange = plan.changes?.[plan.changes.length - 1];
  return (
    <article className="prog" key={plan.createdAt}>
      <header className="prog-head">
        <div className="prog-meta mono">
          <span>{plan.city}</span>
          <span>{plan.members.length} people</span>
          {plan.vibe && <span>{plan.vibe}</span>}
          <span className={`tag ${live ? "live" : ""}`}>
            {live ? "Qloo live data" : "Sample data"} · {plan.mode.planner === "llm" ? plan.mode.model : "rule-based planner"}
          </span>
        </div>
        <h2>{plan.title}</h2>
        <p className="prog-sum">{plan.summary}</p>
        {previous && lastChange && (
          <p className="prog-change">
            <span className="mono">What changed</span> {lastChange}
          </p>
        )}
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
          <Stop key={s.slot} stop={s} plan={plan} n={n} changed={changedSlot(s)} />
        ))}
      </ol>
      {plan.critiques && plan.critiques.length > 0 && (
        <div className="prog-critic">
          <span className="mono">How the agent kept it fair</span>
          <ul>
            {plan.critiques.slice(-3).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {footer}
      <div className="prog-actions">
        <button className="btn btn-signal btn-sm" onClick={share}>
          Send to the group <span className="arr" aria-hidden>↗</span>
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
          Print
        </button>
        {shared && (
          <a className="btn btn-ink btn-sm" href={`${BASE_PATH}/`}>
            Plan your own night <span className="arr" aria-hidden>→</span>
          </a>
        )}
        {plan.stats && (
          <span className="prog-stats mono">
            {plan.stats.qlooCalls} Qloo calls · {plan.stats.llmTurns} agent turns · {(plan.stats.ms / 1000).toFixed(0)}s
          </span>
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

export function ItinerarySkeleton({ note = "Drawing up your circle’s programme…" }: { note?: string }) {
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
      <p className="skel-note mono">{note}</p>
    </div>
  );
}
