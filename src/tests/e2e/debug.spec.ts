import { test, expect } from "@playwright/test";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";

const EXAMPLES_DIR = path.resolve(__dirname, "../../../examples");

test("diagnose Claude submission flow", async ({ page }) => {
  test.setTimeout(120_000);

  // Capture all browser console output
  const consoleLogs: string[] = [];
  page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  // Track network requests
  const requests: { url: string; status: number; body: string }[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      try {
        const body = await res.text();
        requests.push({ url: res.url(), status: res.status(), body });
      } catch {}
    }
  });

  // Capture WebSocket frames
  const wsFrames: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => wsFrames.push(`← ${frame.payload}`));
    ws.on("framesent", (frame) => wsFrames.push(`→ ${frame.payload}`));
  });

  // Create test file
  const FILE = "tmp-debug-test.md";
  const ORIGINAL = "# Debug\n\nThe sky is blue.\n\nKeep this.\n";
  writeFileSync(path.join(EXAMPLES_DIR, FILE), ORIGINAL);

  try {
    await page.goto("/");
    await expect(page.locator(".file-item").first()).toBeVisible({ timeout: 10_000 });

    const btn = page.locator(`.file-item[data-path="${FILE}"]`);
    await expect(btn).toBeVisible({ timeout: 5_000 });
    await btn.click();
    await expect(btn).toHaveClass(/active/);

    // Wait a bit for file content to render
    await page.waitForTimeout(500);

    const docText = await page.locator("#doc").textContent();
    console.log("Doc text:", docText);

    // Simulate shift+select on first paragraph
    const selected = await page.evaluate(() => {
      const el = document.querySelector("#doc p") as HTMLElement;
      if (!el) return "NO_P_FOUND";
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, shiftKey: true }));
      return window.getSelection()!.toString();
    });
    console.log("Selected text:", selected);

    await page.waitForTimeout(100);

    const currentFile = await page.evaluate(() => (window as any).currentFile ?? "NOT_SET");
    const pendingSel = await page.evaluate(() => (window as any).pendingSelection ?? "NOT_SET");
    console.log("currentFile:", currentFile);
    console.log("pendingSelection:", pendingSel);

    await page.locator("#chat-input").fill("Replace 'blue' with 'red'");

    // Intercept the POST and log it
    const commentResp = page.waitForResponse("/api/comment");
    await page.locator("#chat-send").click();

    const resp = await commentResp;
    console.log("/api/comment response:", resp.status(), await resp.text());

    // Now wait up to 60s for either done or error
    const result = await Promise.race([
      page.locator(".chat-event-icon.done").waitFor({ timeout: 60_000 }).then(() => "done"),
      page.locator("#status-bar:not(.hidden)").waitFor({ timeout: 60_000 }).then(() => "error"),
    ]).catch(() => "timeout");

    console.log("Result:", result);

    if (result === "error") {
      const errText = await page.locator("#status-text").textContent();
      console.log("Error text:", errText);
    }

    console.log("Console logs:", consoleLogs.join("\n"));
    console.log("WS frames:", wsFrames.slice(0, 20).join("\n"));
    console.log("Requests:", requests.map(r => `${r.url} → ${r.status}: ${r.body}`).join("\n"));

    expect(result).toBe("done");
  } finally {
    if (existsSync(path.join(EXAMPLES_DIR, FILE))) {
      unlinkSync(path.join(EXAMPLES_DIR, FILE));
    }
  }
});
