import { defineConfig } from "@playwright/test";
import path from "path";

const BUN = `${process.env.HOME}/.bun/bin/bun`;
const ROOT = path.resolve(__dirname);

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
    // Suppress browser-open during tests
    env: { DISPLAY: "" },
  },

  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },

  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
