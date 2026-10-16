import { IS_STATIC_DEMO, BASE_PATH } from "@/lib/client";

export const REPO_URL = "https://github.com/PhamNghia1508/DichVuCamDo";

export function Nav() {
  return (
    <>
      {IS_STATIC_DEMO && (
        <div className="banner">
          <span className="mono">Static demo</span> — runs on hand-written sample data in your browser. The live Qloo + LLM version is
          linked in the <a href={REPO_URL}>README</a>.
        </div>
      )}
      <header className="nav wrap">
        <a className="brand" href={`${BASE_PATH}/`} aria-label="TasteCircle home">
          <svg className="brand-mark" viewBox="0 0 40 28" aria-hidden>
            <circle cx="12" cy="14" r="10.5" />
            <circle cx="28" cy="14" r="10.5" />
            <path d="M20 6.6a10.5 10.5 0 0 1 0 14.8a10.5 10.5 0 0 1 0-14.8Z" className="lens" />
          </svg>
          <span>
            Taste<em>Circle</em>
          </span>
        </a>
        <nav className="nav-links" aria-label="Main">
          <a className="hide-sm" href={`${BASE_PATH}/#how`}>How it works</a>
          <a className="hide-sm" href={`${BASE_PATH}/#plan`}>Plan a night</a>
          <a className="nav-gh" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub <span aria-hidden>↗</span>
          </a>
        </nav>
      </header>
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot wrap">
      <div className="foot-big" aria-hidden>
        Taste<em>Circle</em>
      </div>
      <div className="foot-row">
        <span>Built for the Qloo Agentic Hackathon · MIT licensed</span>
        <span>
          Taste data by{" "}
          <a href="https://www.qloo.com" target="_blank" rel="noreferrer">
            Qloo
          </a>{" "}
          · <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
        </span>
      </div>
    </footer>
  );
}
