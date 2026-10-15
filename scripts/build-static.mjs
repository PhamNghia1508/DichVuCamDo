// Builds the static GitHub Pages demo into ./out.
// Route handlers can't be statically exported, so app/api is moved aside for
// the duration of the build; the browser runs the agent on mock data instead.
import { execSync } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";

const api = "app/api";
const parked = ".api-parked";
const basePath = process.env.PAGES_BASE_PATH ?? "/DichVuCamDo";
if (existsSync(api)) renameSync(api, parked);
try {
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, STATIC_DEMO: "1", PAGES_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: "1" },
  });
  writeFileSync("out/.nojekyll", "");
  console.log(`\nStatic demo ready in ./out (basePath "${basePath}")`);
} finally {
  if (existsSync(parked)) renameSync(parked, api);
}
