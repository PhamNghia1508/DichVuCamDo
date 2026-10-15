import { IS_STATIC_DEMO, BASE_PATH } from "@/lib/client";

export const REPO_URL = "https://github.com/PhamNghia1508/tastecircle";

export function Nav() {
  return (
    <>
      {IS_STATIC_DEMO && (
        <div className="banner">
          Static demo running on hand-written sample data in your browser. Live Qloo + LLM version: see the{" "}
          <a href={REPO_URL}>README</a>.
        </div>
      )}
      <div className="wrap">
        <nav className="nav">
          <a className="brand" href={`${BASE_PATH}/`}>
            <span className="brand-mark">
              <span />
              <span />
            </span>
            TasteCircle
          </a>
          <div className="nav-links">
            <a className="hide-sm" href={`${BASE_PATH}/#how`}>How it works</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </nav>
      </div>
    </>
  );
}

export function Footer() {
  return (
    <div className="wrap">
      <footer>
        <span>TasteCircle · built for the Qloo Agentic Hackathon · MIT licensed</span>
        <span>
          Taste data by <a href="https://www.qloo.com" target="_blank" rel="noreferrer">Qloo</a>
        </span>
      </footer>
    </div>
  );
}
