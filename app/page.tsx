"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GroupBuilder } from "@/components/GroupBuilder";
import { AgentTrace } from "@/components/AgentTrace";
import { Itinerary, ItinerarySkeleton } from "@/components/Itinerary";
import { TasteMap } from "@/components/TasteMap";
import { Compare } from "@/components/Compare";
import { Refine } from "@/components/Refine";
import { Nav, Footer } from "@/components/Chrome";
import { Avatar, colorFor } from "@/components/ui";
import { fetchBaseline, inviteLink, planNight, readInvite, refinePlan } from "@/lib/client";
import { PRESETS, type Preset } from "@/lib/presets";
import type { AgentEvent, BaselineResult, MemberInput, Plan, TasteMap as TMap } from "@/lib/types";

const blank = (name = ""): MemberInput => ({ name, tastes: { artist: [], movie: [], place: [], book: [] } });
const filledOf = (ms: MemberInput[]) => ms.filter((m) => Object.values(m.tastes).some((l) => l.length));

const TICKER = ["Radiohead", "The Bear", "tacos", "Spirited Away", "Taylor Swift", "ramen", "Norwegian Wood", "Kendrick Lamar", "Fleabag", "Đen Vâu", "Little Simz", "Lost in Translation"];

function Rings() {
  return (
    <figure className="rings" aria-hidden>
      <svg viewBox="0 0 400 380">
        <g className="ring r1">
          <circle cx="140" cy="140" r="112" />
          <text x="62" y="96">sad indie · ramen</text>
        </g>
        <g className="ring r2">
          <circle cx="260" cy="140" r="112" />
          <text x="262" y="96">pop · pizza</text>
        </g>
        <g className="ring r3">
          <circle cx="200" cy="244" r="112" />
          <text x="160" y="330">rap · tacos</text>
        </g>
        <path className="lens" d="M200 112 Q228 160 200 205 Q172 160 200 112 Z" />
        <circle className="core" cx="200" cy="176" r="7" />
      </svg>
      <figcaption className="mono">
        <span className="dot" /> the overlap is your night
      </figcaption>
    </figure>
  );
}

function ChatDeadlock() {
  const lines: [string, number, string][] = [
    ["Maya", 0, "ok where are we going tonight"],
    ["Jordan", 1, "anywhere’s fine"],
    ["Priya", 2, "not another sports bar pls"],
    ["Jordan", 1, "not sushi again either"],
    ["Maya", 0, "…I’ll just pick something"],
  ];
  return (
    <div className="chat" aria-label="A typical group chat">
      <div className="chat-top mono">
        <span>the group chat</span>
        <span>Fri 6:41 PM</span>
      </div>
      {lines.map(([who, i, text], k) => (
        <div key={k} className={`bubble ${i === 0 ? "me" : ""}`} style={{ ["--m" as string]: colorFor(i), animationDelay: `${k * 0.18}s` }}>
          {i !== 0 && <span className="bubble-who">{who}</span>}
          {text}
        </div>
      ))}
      <div className="bubble tc" style={{ animationDelay: "1.1s" }}>
        <span className="bubble-who mono">TasteCircle</span>
        Dinner Qloo ties to all three of you, then a bar picked as Priya’s bridge. A reason for each of you, inside.
      </div>
    </div>
  );
}

function PresetPicker({ onPick, active }: { onPick: (p: Preset) => void; active?: string }) {
  return (
    <div className="presets">
      <span className="mono presets-label">Or start from a sample circle</span>
      <div className="presets-row">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={`preset ${active === p.id ? "on" : ""}`} onClick={() => onPick(p)}>
            <span className="preset-city">{p.city}</span>
            <span className="preset-faces">
              {p.members.map((m, i) => (
                <Avatar key={m.name} name={m.name} i={i} />
              ))}
            </span>
            <span className="preset-blurb">{p.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [members, setMembers] = useState<MemberInput[]>([blank(), blank()]);
  const [city, setCity] = useState("");
  const [vibe, setVibe] = useState("");
  const [preset, setPreset] = useState<string | undefined>();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [prev, setPrev] = useState<Plan | null>(null);
  const [liveMap, setLiveMap] = useState<TMap | null>(null);
  const [running, setRunning] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<BaselineResult | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ host?: string; you: number } | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const plannerRef = useRef<HTMLDivElement>(null);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2200);
  };

  // Joining from an invite link: the circle so far travels in the URL fragment.
  useEffect(() => {
    const load = () => readInvite(window.location.hash).then((inv) => {
      if (!inv) return;
      const ms = [...filledOf(inv.members ?? []).slice(0, 7), blank()];
      setMembers(ms);
      setCity(inv.city ?? "");
      setVibe(inv.vibe ?? "");
      setInvite({ host: inv.host, you: ms.length - 1 });
      history.replaceState(null, "", window.location.pathname);
      setTimeout(() => plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    });
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  const filled = filledOf(members).length;
  const canPlan = filled >= 2 && city.trim().length > 0 && !running;

  const loadBaseline = useCallback(async (p: Plan) => {
    setBaseLoading(true);
    setBaseError(null);
    try {
      setBaseline(await fetchBaseline(p));
    } catch (err) {
      setBaseError((err as Error).message.slice(0, 120));
    } finally {
      setBaseLoading(false);
    }
  }, []);

  async function go() {
    setError(null);
    setPlan(null);
    setPrev(null);
    setLiveMap(null);
    setBaseline(null);
    setEvents([]);
    setRunning(true);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    try {
      const p = await planNight(
        { members: members.map((m, i) => ({ ...m, name: m.name.trim() || `Friend ${i + 1}` })), city, vibe: vibe || undefined },
        (e) => {
          setEvents((prevE) => [...prevE, e]);
          if (e.type === "taste_map") setLiveMap(e.map);
        },
      );
      setPlan(p);
      loadBaseline(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function refine(message: string) {
    if (!plan) return;
    setRefining(true);
    setRunning(true);
    setError(null);
    try {
      const next = await refinePlan(plan, message, (e) => setEvents((prevE) => [...prevE, e]));
      setPrev(plan);
      setPlan(next);
      if (next.city !== plan.city) {
        setBaseline(null);
        loadBaseline(next);
      }
    } catch (err) {
      flash((err as Error).message.slice(0, 90));
    } finally {
      setRefining(false);
      setRunning(false);
    }
  }

  function loadPreset(p: Preset) {
    setMembers(p.members.map((m) => ({ ...m, tastes: { ...m.tastes } })));
    setCity(p.city);
    setVibe(p.vibe);
    setPreset(p.id);
    setInvite(null);
    setTimeout(() => plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  async function shareInvite() {
    const url = await inviteLink({
      city,
      vibe: vibe || undefined,
      host: invite ? invite.host : members[0]?.name || undefined,
      members: filledOf(members).map((m, i) => ({ ...m, name: m.name.trim() || `Friend ${i + 1}` })),
    });
    setInviteUrl(url);
    try {
      if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ title: "Join our TasteCircle", text: `Add your favourites for ${city || "our night out"}`, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("Invite link copied");
      }
    } catch {
      /* cancelled */
    }
  }

  const hint = running
    ? "The agent is planning…"
    : filled < 2
      ? "Two people with at least one favourite each."
      : !city.trim()
        ? "Which city are you going out in?"
        : `${filled} people in · ready when you are`;

  const showResults = running || plan || events.length > 0 || error;

  return (
    <main>
      <Nav />

      <section className="hero wrap">
        <div className="hero-meta mono">
          <span>Group night-out planner</span>
          <span className="hide-sm">Taste data by Qloo</span>
        </div>
        <h1 className="hero-title">
          <span className="line">One night out.</span>
          <span className="line">
            <em>Everyone’s</em> taste.
          </span>
        </h1>
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="lede">
              Everyone drops in what they love — music, films and shows, books and podcasts, places. TasteCircle finds the dinner, the after-plan and the
              playlist your whole group overlaps on, and tells each friend why it’s for them.
            </p>
            <div className="hero-cta">
              <button className="btn btn-ink" onClick={() => plannerRef.current?.scrollIntoView({ behavior: "smooth" })}>
                Start a circle <span className="arr" aria-hidden>→</span>
              </button>
              <button className="btn btn-line" onClick={() => loadPreset(PRESETS[0])}>
                Try a sample circle
              </button>
            </div>
            <dl className="hero-facts">
              <div>
                <dt className="mono">Reads</dt>
                <dd>Six kinds of taste in one Qloo graph</dd>
              </div>
              <div>
                <dt className="mono">Decides</dt>
                <dd>An agent with a fairness critic</dd>
              </div>
              <div>
                <dt className="mono">Proves</dt>
                <dd>Side by side with a plain chatbot</dd>
              </div>
            </dl>
          </div>
          <Rings />
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[0, 1].map((k) => (
            <span key={k}>
              {TICKER.map((t) => (
                <span key={t + k}>
                  {t} <i>×</i>{" "}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <section className="problem wrap">
        <div className="problem-copy">
          <span className="mono problem-k">The problem</span>
          <h2>
            Every group chat has <em>this</em> thread.
          </h2>
          <p>
            Five people, five tastes, and the plan goes to whoever gives up last. Ask a chatbot and it averages the loudest opinions into somewhere
            nobody’s excited about.
          </p>
          <p>
            TasteCircle reads each person’s taste through Qloo’s cultural graph, scores every option for <b>every</b> friend, and won’t sign off on a
            night that leaves someone out.
          </p>
        </div>
        <ChatDeadlock />
      </section>

      <section className="planner wrap" ref={plannerRef} id="plan">
        <div className="sec-head">
          <span className="sec-n mono">01</span>
          <div>
            <h2>Who’s coming?</h2>
            <p>Two to eight people, a few favourites each. Press Enter after each one — or send the link and let everyone add their own.</p>
          </div>
        </div>

        {invite ? (
          <div className="joined">
            <span className="mono">You’re invited</span>
            <p>
              <b>{invite.host || "A friend"}</b> started a circle{city ? ` for ${city}` : ""}. Add your name and a few favourites in the last card, then send the
              link back — or plan the night right here.
            </p>
          </div>
        ) : (
          <PresetPicker onPick={loadPreset} active={preset} />
        )}

        <div className="trip">
          <label className="field">
            <span className="mono">City</span>
            <input id="city" value={city} placeholder="New York, Tokyo, Saigon…" onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="field">
            <span className="mono">Vibe · optional</span>
            <input id="vibe" value={vibe} placeholder="birthday, low-key, cheap eats…" onChange={(e) => setVibe(e.target.value)} />
          </label>
        </div>

        <GroupBuilder members={members} onChange={setMembers} highlight={invite?.you} />

        <div className="go-bar">
          <span className={`hint mono ${canPlan ? "ready" : ""}`}>
            <span className="dot" /> {hint}
          </span>
          <div className="go-actions">
            <button className="btn btn-line" disabled={filled < 1} onClick={shareInvite}>
              {invite ? "Send it back to the group" : "Invite friends"}
            </button>
            <button className="btn btn-signal btn-lg" disabled={!canPlan} onClick={go}>
              {running && !refining ? "Planning…" : "Plan our night"} <span className="arr" aria-hidden>→</span>
            </button>
          </div>
        </div>
        {inviteUrl && (
          <div className="invite-sheet">
            <span className="mono">Invite link · nothing stored, the circle lives in the link</span>
            <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <p>Drop it in the group chat. Each friend adds their favourites and sends the updated link on — whoever’s last hits plan.</p>
          </div>
        )}
      </section>

      <div ref={resultsRef} className="anchor" />
      {showResults && (
        <section className="results wrap">
          <div className="sec-head">
            <span className="sec-n mono">02</span>
            <div>
              <h2>{plan ? "Tonight’s programme" : error ? "That didn’t work" : "The agent at work"}</h2>
              <p>
                {plan
                  ? "Every stop scored against each of you. Check the fit bars, ask for changes, then send it to the group."
                  : error
                    ? "Nothing was saved — tweak the circle and try again."
                    : "Live from the planner: every Qloo call, every decision, the critic’s notes."}
              </p>
            </div>
          </div>
          <div className="results-grid">
            <AgentTrace events={events} running={running} />
            <div className="results-main">
              {plan ? (
                <Itinerary plan={plan} previous={prev} footer={<Refine plan={plan} running={refining} onSubmit={refine} />} />
              ) : error ? (
                <div className="empty">
                  <p className="empty-h">The agent couldn’t finish this one.</p>
                  <p>{error}</p>
                  <div className="empty-actions">
                    <button className="btn btn-ink btn-sm" onClick={go} disabled={!canPlan}>
                      Try again
                    </button>
                    <button className="btn btn-line btn-sm" onClick={() => loadPreset(PRESETS[0])}>
                      Use a sample circle
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {liveMap && <TasteMap map={liveMap} compact />}
                  <ItinerarySkeleton note={liveMap ? "Fingerprints in. Scoring every option for every friend…" : "Reading everyone’s taste…"} />
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {plan?.tasteMap && (
        <section className="decoded wrap">
          <div className="sec-head">
            <span className="sec-n mono">03</span>
            <div>
              <h2>Your circle, decoded</h2>
              <p>What Qloo’s taste analysis says about each of you — and the thin line the plan was built on.</p>
            </div>
          </div>
          <TasteMap map={plan.tasteMap} plan={plan} />
        </section>
      )}

      {plan && (
        <section className="versus wrap">
          <div className="sec-head">
            <span className="sec-n mono">04</span>
            <div>
              <h2>Why not just ask a chatbot?</h2>
              <p>We did. Here’s what the same model suggests for the same group with no Qloo data — scored by Qloo, for each of you.</p>
            </div>
          </div>
          <Compare plan={plan} data={baseline} loading={baseLoading} error={baseError} onRetry={() => loadBaseline(plan)} />
        </section>
      )}

      <section className="how wrap" id="how">
        <div className="sec-head">
          <span className="sec-n mono">{plan ? "05" : showResults ? "03" : "02"}</span>
          <div>
            <h2>How it works</h2>
            <p>One taste graph, an agent that checks its own work, and no averaging people out.</p>
          </div>
        </div>
        <ol className="how-list">
          <li>
            <span className="how-n">i.</span>
            <h3>Read every taste</h3>
            <p>
              Favourites resolve to Qloo entities with <code>/search</code> — artists, films, TV, books, podcasts, places. Taste analysis on{" "}
              <code>/v2/insights</code> fingerprints each friend; <code>/v2/insights/compare</code> finds the bridge between the two furthest apart.
            </p>
          </li>
          <li>
            <span className="how-n">ii.</span>
            <h3>Score for every friend</h3>
            <p>
              <code>/v2/insights</code> runs once for the group and once per friend, with venue-category tags and explainability. A harmonic-mean consensus
              means one unhappy friend sinks a pick.
            </p>
          </li>
          <li>
            <span className="how-n">iii.</span>
            <h3>Decide, critique, refine</h3>
            <p>
              A tool-calling agent picks the night, runs bridge searches when someone’s left out, and a critic rejects drafts that ignore them. Ask for a
              change and it goes back to Qloo — never to its imagination.
            </p>
          </li>
        </ol>
      </section>
      <Footer />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
