# TasteCircle

**One night out. Everyone's taste.**
TasteCircle is an AI agent that plans a group outing everyone will actually enjoy. Each friend drops in a few favourite artists, films, restaurants and books; the agent uses [Qloo's Taste AI](https://www.qloo.com) to find the **dinner → activity → playlist** the whole group overlaps on, and writes a one-line *why* for every member. The result is a shareable itinerary link.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).

- **Live app:** _coming soon (Vercel)_ · **Static demo (sample data, no server):** https://phamnghia1508.github.io/tastecircle/
- **License:** [MIT](./LICENSE)

---

## How it works

```
 friends' favourites ──► resolve_group_tastes ──► find_tags ──► group_consensus ×3-4 ──► finalize_itinerary
   (free text)            Qloo GET /search        GET /v2/tags   GET /v2/insights          shareable plan
```

1. **Resolve tastes.** Every free-text favourite is matched to a Qloo entity with `GET /search` (`types=urn:entity:artist|movie|place|book`).
2. **Score for the group, not the average.** For each slot (dinner, activity, playlist, film) the `group_consensus` tool calls
   - `GET /v2/insights` once with **everyone's** entities in `signal.interests.entities` → the candidate pool, and
   - `GET /v2/insights` once **per member** with only their entities and `filter.results.entities=<pool>` → each member's own affinity for every candidate.

   Candidates are ranked by
   `consensus = 0.45 · groupAffinity + 0.55 · harmonicMean(memberAffinities)` and
   `fairness = min(member) / max(member)`.
   The harmonic mean is deliberate: if one friend scores a pick near zero it sinks, so the agent prefers "everyone likes it" over "two love it, one hates it".
3. **Explain.** `feature.explainability=true` tells us which input entities drove each recommendation; we map those back to the member who entered them, so every pick comes with *"Linh — lines up with your love of Taylor Swift and La La Land"*.
4. **Plan.** An LLM runs a tool-calling loop over four tools (`resolve_group_tastes`, `find_tags`, `group_consensus`, `finalize_itinerary`), picks with consensus *and* fairness in mind, and writes the copy. Places use `filter.location.query=<city>` and tag filters (restaurant vs. nightlife/venue) found through `/v2/tags`.
5. **Share.** The finished plan is encoded into the URL fragment (`/plan#…`), so sharing needs no database and nothing is stored server-side.

The agent's tool calls stream live to the UI (newline-delimited JSON from `POST /api/plan`), so you watch it work.

### Modes — it always runs

| | Key set | Key missing |
|---|---|---|
| **Qloo** (`QLOO_API_KEY`) | live hackathon API | **mock mode**: a hand-written sample catalog in `lib/mock/catalog.ts` (fictional venues; not Qloo data) |
| **LLM** (`LLM_API_KEY`) | OpenAI-compatible tool-calling agent | **deterministic planner**: same tools, fixed order, templated copy |

## Run it locally

Requires Node 18.18+.

```bash
git clone https://github.com/PhamNghia1508/tastecircle.git
cd tastecircle
npm install
cp .env.example .env.local   # optional: fill in keys; empty = mock mode
npm run dev                  # http://localhost:3000
```

Click **Try an example group → Plan our night**.

Other scripts:

```bash
npm test               # mock-mode end-to-end smoke test + LLM tool-loop test (no keys, no network)
npm run typecheck
npm run build && npm start
npm run build:static   # static GitHub Pages demo into ./out (agent runs in-browser on sample data)
```

### Environment variables

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY` | Qloo hackathon key (sent as `X-Api-Key`, server-side only) |
| `QLOO_BASE_URL` | defaults to `https://hackathon.api.qloo.com` |
| `LLM_API_KEY` | any OpenAI-compatible chat-completions key with tool calling |
| `LLM_BASE_URL` | e.g. `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com/v1beta/openai` (Gemini), `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | e.g. `gpt-4o-mini`, `gemini-2.5-flash`, `llama-3.3-70b-versatile` |
| `TASTECIRCLE_FORCE_MOCK` | set to `1` to force mock Qloo data even with a key |

`GET /api/health` reports which modes are active (never the keys).

## Deploy (Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPhamNghia1508%2Ftastecircle&env=QLOO_API_KEY,LLM_API_KEY,LLM_BASE_URL,LLM_MODEL&envDescription=Qloo%20hackathon%20key%20and%20an%20OpenAI-compatible%20LLM%20key%20(both%20optional%3A%20empty%20%3D%20mock%2Fdeterministic%20mode))

1. Import this repo at [vercel.com/new](https://vercel.com/new) (framework: Next.js, no config needed) — or use the button above.
2. Add `QLOO_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` under *Settings → Environment Variables*.
3. Deploy. `POST /api/plan` runs as a Node function (`maxDuration = 120`, within the Hobby plan's 300 s limit).

## Project layout

```
app/
  page.tsx              planner UI (group builder, live agent trace, itinerary)
  plan/page.tsx         shared itinerary view (plan decoded from URL fragment)
  api/plan/route.ts     POST: runs the agent, streams AgentEvents as NDJSON
  api/health/route.ts   GET: which modes are active
lib/
  qloo.ts               Qloo client (GET /search, /v2/insights, /v2/tags) + mock switch
  agent/consensus.ts    group-vs-member insights calls, consensus & fairness scoring
  agent/tools.ts        tool schemas + implementations for the agent
  agent/run.ts          LLM tool-calling loop + deterministic fallback planner
  mock/catalog.ts       hand-written sample catalog for mock mode
components/             GroupBuilder, AgentTrace, Itinerary
scripts/                smoke test, LLM-loop test, static build
```

## Data & keys

- Only GET requests to `/search`, `/v2/insights` and `/v2/tags` on the hackathon base URL. The legacy `/recs` and `/recommendations` endpoints are never used.
- Qloo responses live in memory for one request only; nothing is cached to disk and **no Qloo response data is committed** to this repository. `.gitignore` also blocks `.env*` files and any `qloo-cache/` or `*.qloo.json` files.
- Keys are read from environment variables on the server and never sent to the browser.

## License

[MIT](./LICENSE) © 2026 Phạm Nhật Nghĩa
