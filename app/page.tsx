"use client";
import { useRef, useState } from "react";
import { GroupBuilder } from "@/components/GroupBuilder";
import { AgentTrace } from "@/components/AgentTrace";
import { Itinerary, ItinerarySkeleton } from "@/components/Itinerary";
import { Nav, Footer } from "@/components/Chrome";
import { planNight } from "@/lib/client";
import type { AgentEvent, MemberInput, Plan } from "@/lib/types";

const blank = (name = ""): MemberInput => ({ name, tastes: { artist: [], movie: [], place: [], book: [] } });

const EXAMPLE: { city: string; vibe: string; members: MemberInput[] } = {
  city: "Ho Chi Minh City",
  vibe: "chill Friday, not too pricey",
  members: [
    { name: "Gô", tastes: { artist: ["Radiohead", "Đen Vâu"], movie: ["Interstellar"], place: ["ramen"], book: ["Norwegian Wood"] } },
    { name: "Linh", tastes: { artist: ["Taylor Swift", "Norah Jones"], movie: ["La La Land"], place: ["pizza"], book: ["The Little Prince"] } },
    { name: "Minh", tastes: { artist: ["Kendrick Lamar", "Daft Punk"], movie: ["Spirited Away"], place: ["tacos"], book: [] } },
  ],
};

const TICKER = ["Radiohead", "La La Land", "tacos", "Spirited Away", "Taylor Swift", "ramen", "Norwegian Wood", "Kendrick Lamar", "Interstellar", "pizza", "Đen Vâu", "Daft Punk"];

function Rings() {
  return (
    <figure className="rings" aria-hidden>
      <svg viewBox="0 0 400 380">
        <g className="ring r1">
          <circle cx="140" cy="140" r="112" />
          <text x="62" y="96">indie · ramen</text>
        </g>
        <g className="ring r2">
          <circle cx="260" cy="140" r="112" />
          <text x="268" y="96">pop · pizza</text>
        </g>
        <g className="ring r3">
          <circle cx="200" cy="244" r="112" />
          <text x="160" y="330">rap · tacos</text>
        </g>
        <path className="lens" d="M200 112 Q228 160 200 205 Q172 160 200 112 Z" />
        <circle className="core" cx="200" cy="176" r="7" />
      </svg>
      <figcaption className="mono">
        <span className="dot" /> the overlap = your night
      </figcaption>
    </figure>
  );
}

export default function Home() {
  const [members, setMembers] = useState<MemberInput[]>([blank(), blank()]);
  const [city, setCity] = useState("");
  const [vibe, setVibe] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const plannerRef = useRef<HTMLDivElement>(null);

  const filled = members.filter((m) => Object.values(m.tastes).some((l) => l.length)).length;
  const canPlan = filled >= 2 && city.trim().length > 0 && !running;

  async function go() {
    setError(null);
    setPlan(null);
    setEvents([]);
    setRunning(true);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    try {
      const p = await planNight(
        { members: members.map((m, i) => ({ ...m, name: m.name.trim() || `Friend ${i + 1}` })), city, vibe: vibe || undefined },
        (e) => setEvents((prev) => [...prev, e]),
      );
      setPlan(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function loadExample() {
    setMembers(EXAMPLE.members);
    setCity(EXAMPLE.city);
    setVibe(EXAMPLE.vibe);
    setTimeout(() => plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  const hint =
    filled < 2 ? "Add favourites for at least two people." : !city.trim() ? "Add a city to search venues in." : `${filled} people ready — let’s go.`;

  return (
    <main>
      <Nav />

      <section className="hero wrap">
        <div className="hero-meta mono">
          <span>An AI agent for group nights out</span>
          <span className="hide-sm">Powered by Qloo Taste AI</span>
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
              Everyone drops in a few favourite artists, films, spots and books. The agent finds the dinner, the after-plan and
              the playlist your whole group actually overlaps on, then tells each friend why it’s for them.
            </p>
            <div className="hero-cta">
              <button className="btn btn-ink" onClick={() => plannerRef.current?.scrollIntoView({ behavior: "smooth" })}>
                Start your circle <span className="arr" aria-hidden>→</span>
              </button>
              <button className="btn btn-line" onClick={loadExample}>
                Try an example group
              </button>
            </div>
            <dl className="hero-facts">
              <div>
                <dt className="mono">Signals</dt>
                <dd>Artists, films, places, books</dd>
              </div>
              <div>
                <dt className="mono">Scoring</dt>
                <dd>Harmonic-mean consensus</dd>
              </div>
              <div>
                <dt className="mono">Output</dt>
                <dd>A shareable plan, a reason for everyone</dd>
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

      <section className="planner wrap" ref={plannerRef} id="plan">
        <div className="sec-head">
          <span className="sec-n mono">01</span>
          <div>
            <h2>Who’s coming?</h2>
            <p>Two to eight people. A few favourites each is plenty — press Enter after each one.</p>
          </div>
        </div>

        <div className="trip">
          <label className="field">
            <span className="mono">City</span>
            <input id="city" value={city} placeholder="Ho Chi Minh City, Brooklyn, Lisbon…" onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="field">
            <span className="mono">Vibe · optional</span>
            <input id="vibe" value={vibe} placeholder="birthday, low-key, cheap eats…" onChange={(e) => setVibe(e.target.value)} />
          </label>
        </div>

        <GroupBuilder members={members} onChange={setMembers} />

        <div className="go-bar">
          <span className={`hint mono ${canPlan ? "ready" : ""}`}>
            <span className="dot" /> {running ? "The agent is planning…" : hint}
          </span>
          <button className="btn btn-signal btn-lg" disabled={!canPlan} onClick={go}>
            {running ? "Planning…" : "Plan our night"} <span className="arr" aria-hidden>→</span>
          </button>
        </div>
        {error && !running && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </section>

      <div ref={resultsRef} className="anchor" />
      {(running || plan || events.length > 0) && (
        <section className="results wrap">
          <div className="sec-head">
            <span className="sec-n mono">02</span>
            <div>
              <h2>{plan ? "Tonight’s programme" : "The agent at work"}</h2>
              <p>{plan ? "Every pick scored against all of your tastes. Share it with the group." : "Live from the planner: every Qloo call and decision, as it happens."}</p>
            </div>
          </div>
          <div className="results-grid">
            <AgentTrace events={events} running={running} />
            {plan ? <Itinerary plan={plan} /> : error ? <div className="empty">{error}</div> : <ItinerarySkeleton />}
          </div>
        </section>
      )}

      <section className="how wrap" id="how">
        <div className="sec-head">
          <span className="sec-n mono">{plan || running ? "03" : "02"}</span>
          <div>
            <h2>How it works</h2>
            <p>One taste graph, three moves. No averaging people out.</p>
          </div>
        </div>
        <ol className="how-list">
          <li>
            <span className="how-n">i.</span>
            <h3>Resolve every taste</h3>
            <p>
              Each favourite is matched to a Qloo entity with <code>/search</code> — artists, films, places and books all live in
              one graph.
            </p>
          </li>
          <li>
            <span className="how-n">ii.</span>
            <h3>Score for the whole group</h3>
            <p>
              <code>/v2/insights</code> runs once for the group and once per friend. A harmonic-mean consensus means nobody gets
              left out to please the majority.
            </p>
          </li>
          <li>
            <span className="how-n">iii.</span>
            <h3>Choose and explain</h3>
            <p>
              An LLM agent weighs consensus against fairness, picks dinner → activity → playlist, and writes a “why” for every
              friend from Qloo’s explainability.
            </p>
          </li>
        </ol>
      </section>
      <Footer />
    </main>
  );
}
