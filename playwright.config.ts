import { defineConfig } from "@playwright/test";
import path from "path";

const BUN = `${process.env.HOME}/.bun/bin/bun`;
const ROOT = path.resolve(__dirname);

// Strip Claude Code nesting markers from the webServer environment so the
// Agent SDK can spawn `claude` freely from within the server process.
const serverEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined) serverEnv[k] = v;
}
delete serverEnv.CLAUDECODE;
delete serverEnv.CLAUDE_CODE_ENTRYPOINT;
serverEnv.DISPLAY = "";

export default defineConfig({
  testDir: "./src/tests/e2e",
  timeout: 20_000,
  retries: 0,
  reporter: "line",

  webServer: {
    command: `${BUN} ${ROOT}/src/index.ts ${ROOT}/examples`,
    port: 3333,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: serverEnv,
  },

  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },

  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
