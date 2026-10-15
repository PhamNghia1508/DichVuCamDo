/**
 * Two build targets:
 *  - default (Vercel / `next start`): full app with server route handlers that
 *    hold QLOO_API_KEY and LLM_API_KEY.
 *  - STATIC_DEMO=1: static export for GitHub Pages. No server, so the agent runs
 *    in the browser against the hand-written mock catalog only.
 */
const isStatic = process.env.STATIC_DEMO === "1";
const basePath = process.env.PAGES_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStatic
    ? { output: "export", basePath, assetPrefix: basePath || undefined, images: { unoptimized: true }, trailingSlash: true }
    : {}),
  env: {
    NEXT_PUBLIC_STATIC_DEMO: isStatic ? "1" : "",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
