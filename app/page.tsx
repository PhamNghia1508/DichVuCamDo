"use client";
import { useRef, useState } from "react";
import { GroupBuilder } from "@/components/GroupBuilder";
import { AgentTrace } from "@/components/AgentTrace";
import { Itinerary } from "@/components/Itinerary";
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

  return (
    <main>
      <Nav />
      <div className="wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">AI agent · powered by Qloo Taste AI</span>
            <h1>
              One night out.
              <br />
              <em>Everyone’s</em> taste.
            </h1>
            <p className="lede">
              Everyone drops in a few favourite artists, films, spots and books. TasteCircle’s agent finds the dinner, the
              after-plan and the playlist your whole group actually overlaps on — and tells each friend why it’s for them.
            </p>
            <div className="hero-cta">
              <button className="btn btn-primary" onClick={() => plannerRef.current?.scrollIntoView({ behavior: "smooth" })}>
                Start your circle
              </button>
              <button className="btn btn-ghost" onClick={loadExample}>
                Try an example group
              </button>
            </div>
          </div>
          <div className="venn" aria-hidden>
            <div className="c c1">indie · ramen</div>
            <div className="c c2">jazz · rom-com</div>
            <div className="c c3">hip-hop · tacos</div>
            <div className="core">your night out</div>
          </div>
        </section>

        <section className="planner" ref={plannerRef} id="plan">
          <h2 className="section-title">Who’s coming?</h2>
          <p className="section-sub">Two to eight people. A few favourites each is plenty — press Enter after each one.</p>
          <div className="trip-bar">
            <div className="field">
              <label htmlFor="city">City</label>
              <input id="city" value={city} placeholder="e.g. Ho Chi Minh City, Brooklyn, Lisbon" onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="vibe">Vibe (optional)</label>
              <input id="vibe" value={vibe} placeholder="e.g. birthday, low-key, cheap eats" onChange={(e) => setVibe(e.target.value)} />
            </div>
            <button className="btn btn-accent" disabled={!canPlan} onClick={go}>
              {running ? "Planning…" : "Plan our night →"}
            </button>
          </div>
          <GroupBuilder members={members} onChange={setMembers} />
          <div className="plan-row">
            <span className="hint">
              {filled < 2 ? "Add favourites for at least two people." : !city.trim() ? "Add a city to search venues in." : `${filled} people ready.`}
            </span>
            <button className="btn btn-primary" disabled={!canPlan} onClick={go}>
              {running ? "Planning…" : "Plan our night"}
            </button>
          </div>
          {error && !running && <div className="error">{error}</div>}
        </section>

        <div ref={resultsRef} />
        {(running || plan || events.length > 0) && (
          <section className="results">
            <AgentTrace events={events} running={running} />
            {plan ? (
              <Itinerary plan={plan} />
            ) : (
              <div className="empty">{error ? error : "Your circle’s itinerary is being drawn up…"}</div>
            )}
          </section>
        )}

        <section className="how" id="how">
          <div className="how-card">
            <div className="n">01</div>
            <h4>Resolve every taste</h4>
            <p>
              Each favourite is matched to a Qloo entity with <code className="k">/search</code> — artists, films, places
              and books all live in one taste graph.
            </p>
          </div>
          <div className="how-card">
            <div className="n">02</div>
            <h4>Score for the whole group</h4>
            <p>
              <code className="k">/v2/insights</code> runs once for the group and once per friend. A harmonic-mean consensus
              score means nobody gets left out to please the majority.
            </p>
          </div>
          <div className="how-card">
            <div className="n">03</div>
            <h4>Plan and explain</h4>
            <p>
              An LLM agent picks dinner → activity → playlist with tool calls, then writes a one-line “why” for every friend
              using Qloo’s explainability.
            </p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}
