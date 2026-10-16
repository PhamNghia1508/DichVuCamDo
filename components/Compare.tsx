"use client";
import type { BaselinePick, BaselineResult, ItineraryStop, Plan, Slot } from "@/lib/types";
import { colorFor } from "./ui";

const pct = (n?: number) => Math.round((n ?? 0) * 100);
const num = (n: number) => (Number.isNaN(n) ? "—" : String(pct(n)));
const SLOT_LABEL: Record<Slot, string> = { dinner: "Dinner", activity: "After dinner", playlist: "Playlist", film: "Movie night" };

function Bars({ scores, members }: { scores?: Record<string, number>; members: string[] }) {
  if (!scores) return null;
  return (
    <span className="cmp-bars" aria-label={members.map((m) => `${m} ${pct(scores[m])}%`).join(", ")}>
      {members.map((m, i) => (
        <span key={m} className="cmp-bar" style={{ ["--m" as string]: colorFor(i), ["--v" as string]: `${Math.max(2, pct(scores[m]))}%` }} title={`${m}: ${pct(scores[m])}% fit`}>
          <i />
        </span>
      ))}
    </span>
  );
}

function stats(list: { memberScores?: Record<string, number>; fairness?: number }[], members: string[]) {
  const scored = list.filter((x) => x.memberScores);
  if (!scored.length) return { fair: NaN, low: NaN };
  const fair = scored.reduce((s, x) => s + (x.fairness ?? 0), 0) / scored.length;
  const low = scored.reduce((s, x) => s + Math.min(...members.map((m) => x.memberScores?.[m] ?? 0)), 0) / scored.length;
  return { fair, low };
}

function Verdict({ p }: { p: BaselinePick }) {
  if (p.elsewhere) return <span className="cmp-flag bad">Qloo knows it — but not in this city</span>;
  if (p.unverified) return <span className="cmp-flag bad">Not found in Qloo’s graph{p.slot === "dinner" || p.slot === "activity" ? " for this city" : ""}</span>;
  if (p.echo) return <span className="cmp-flag warn">Just {p.echo}’s own favourite, handed back</span>;
  if (p.echoes?.length) return <span className="cmp-flag warn">{p.echoes.length} of {p.name.split(",").length} are artists you already entered</span>;
  return null;
}

export function Compare({ plan, data, loading, error, onRetry }: { plan: Plan; data: BaselineResult | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const members = plan.members;
  const ours = (slot: Slot): ItineraryStop | undefined => plan.stops.find((s) => s.slot === slot);
  const slots: Slot[] = ["dinner", "activity", "film", "playlist"];
  const a = data ? stats(data.picks, members) : null;
  const b = stats(plan.stops, members);
  const missing = data ? data.picks.filter((p) => p.unverified).length : 0;
  const echoed = data ? data.picks.filter((p) => p.echo || p.echoes?.length).length : 0;

  return (
    <section className="cmp" aria-label="LLM alone versus TasteCircle with Qloo">
      <div className="cmp-intro">
        <p>
          Same group, same city, same model — once <em>without</em> Qloo, the way you’d ask a chatbot in the group chat. Then Qloo scores both plans on
          the same per-person scale.
        </p>
        {data && a && (
          <dl className="cmp-score">
            <div>
              <dt className="mono">Avg fairness</dt>
              <dd>
                <span className="was">{num(a.fair)}</span>
                <span className="now">{pct(b.fair)}</span>
              </dd>
            </div>
            <div>
              <dt className="mono">Least-served friend</dt>
              <dd>
                <span className="was">{num(a.low)}</span>
                <span className="now">{pct(b.low)}</span>
              </dd>
            </div>
            <div>
              <dt className="mono">Unverifiable / echoed picks</dt>
              <dd>
                <span className="was">{missing + echoed}</span>
                <span className="now">0</span>
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="cmp-table" role="table">
        <div className="cmp-row cmp-th" role="row">
          <span role="columnheader" />
          <span role="columnheader" className="mono">
            {data?.model?.startsWith("generic") ? "Generic picks · no Qloo" : `${data?.model ?? "Chatbot"} · no Qloo`}
          </span>
          <span role="columnheader" className="mono">
            TasteCircle · Qloo
          </span>
        </div>
        {slots.map((slot) => {
          const p = data?.picks.find((x) => x.slot === slot);
          const o = ours(slot);
          if (!o) return null;
          return (
            <div className="cmp-row" role="row" key={slot}>
              <span className="cmp-slot mono" role="rowheader">
                {SLOT_LABEL[slot]}
              </span>
              <span className="cmp-cell was" role="cell">
                {loading && !p ? (
                  <span className="sk sk-line" />
                ) : p ? (
                  <>
                    <b>{p.name}</b>
                    <Verdict p={p} />
                    <Bars scores={p.memberScores} members={members} />
                    {p.memberScores && <span className="cmp-meta mono">fair {pct(p.fairness)} · consensus {pct(p.consensus)}</span>}
                  </>
                ) : (
                  <span className="cmp-meta">—</span>
                )}
              </span>
              <span className="cmp-cell now" role="cell">
                <b>{o.entity?.name ?? o.entities?.map((e) => e.name).slice(0, 4).join(", ")}</b>
                <Bars scores={o.memberScores} members={members} />
                <span className="cmp-meta mono">
                  fair {pct(o.fairness)} · consensus {pct(o.consensus)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="cmp-legend mono">
        {members.map((m, i) => (
          <span key={m}>
            <i style={{ background: colorFor(i) }} /> {m}
          </span>
        ))}
        <span className="cmp-note">Bars = each friend’s Qloo taste fit on one scale for both columns · 0 means Qloo rates it below everything it surfaced for that friend.</span>
      </div>
      {loading && <p className="cmp-status mono">Asking the model the same question with no taste data, then auditing its answer with Qloo…</p>}
      {error && (
        <p className="cmp-status mono">
          The comparison didn’t come back ({error}).{" "}
          <button className="linkish" onClick={onRetry}>
            Run it again
          </button>
        </p>
      )}
    </section>
  );
}
