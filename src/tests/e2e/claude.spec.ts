/**
 * Real Claude integration tests.
 *
 * These tests start the server against the examples/ directory, load a
 * temporary markdown file, submit an instruction via the chat panel, wait for
 * Claude to finish, and then assert that the file on disk was actually mutated.
 *
 * Timeout is intentionally long (90 s per test) because Claude needs to spawn,
 * read the file, edit it, and write it back.
 */

import { test, expect } from "@playwright/test";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import path from "path";

const EXAMPLES_DIR = path.resolve(__dirname, "../../../examples");

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create a temporary .md file in examples/, return its relative path. */
function createTmpFile(name: string, content: string): string {
  const abs = path.join(EXAMPLES_DIR, name);
  writeFileSync(abs, content, "utf-8");
  return name;
}

/** Read file content relative to examples/. */
function readTmpFile(name: string): string {
  return readFileSync(path.join(EXAMPLES_DIR, name), "utf-8");
}

/** Delete file if it exists. */
function cleanupTmpFile(name: string) {
  const abs = path.join(EXAMPLES_DIR, name);
  if (existsSync(abs)) unlinkSync(abs);
}

/**
 * Navigate to the app and click on a file in the sidebar by its relative path.
 * Waits until the file is active and the doc is non-empty.
 */
async function openFile(page: any, filePath: string) {
  await page.goto("/");
  await expect(page.locator(".file-item").first()).toBeVisible({ timeout: 10_000 });

  const btn = page.locator(`.file-item[data-path="${filePath}"]`);
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();

  // Wait until content loads into the doc
  await expect(page.locator("#doc")).not.toBeEmpty({ timeout: 5_000 });
}

/**
 * Simulate shift+select on the first paragraph, then type an instruction
 * into the chat input and submit it.
 */
async function submitInstruction(page: any, instruction: string) {
  // Simulate selecting the first paragraph with shift held
  await page.evaluate(() => {
    const el = document.querySelector("#doc p") as HTMLElement;
    if (!el) throw new Error("No paragraph found in #doc");
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, shiftKey: true }));
  });

  // Allow the setTimeout(focus, 0) to fire
  await page.waitForTimeout(80);
  await expect(page.locator("#chat-input")).toBeFocused();

  await page.locator("#chat-input").fill(instruction);
  await page.locator("#chat-send").click();
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("Claude real file edits", () => {
  test.setTimeout(90_000);

  test("Claude replaces specific word in a paragraph", async ({ page }) => {
    const FILE = "tmp-claude-word-replace.md";
    const ORIGINAL = `# Word Replace Test\n\nThe color of the sky is azure.\n\nThis line must stay untouched.\n`;
    createTmpFile(FILE, ORIGINAL);

    try {
      await openFile(page, FILE);

      // The first paragraph is "The color of the sky is azure."
      // Ask Claude to swap one word.
      await submitInstruction(page, "Replace 'azure' with 'cerulean' in the selected text.");

      // Wait for the done ✓ event to appear in the chat
      await expect(page.locator(".chat-event-icon.done")).toBeVisible({ timeout: 80_000 });

      // Give the file-write a moment to flush
      await page.waitForTimeout(500);

      const updated = readTmpFile(FILE);
      expect(updated).toContain("cerulean");
      expect(updated).not.toContain("azure");
      // Unmodified line must survive
      expect(updated).toContain("This line must stay untouched.");
    } finally {
      cleanupTmpFile(FILE);
    }
  });

  test("Claude makes text shorter when asked", async ({ page }) => {
    const FILE = "tmp-claude-shorten.md";
    const ORIGINAL = `# Shorten Test\n\nThis is a very long, unnecessarily verbose, and overly wordy sentence that really does not need all these extra words to convey its simple meaning.\n\nKeep this paragraph exactly as is.\n`;
    createTmpFile(FILE, ORIGINAL);

    try {
      await openFile(page, FILE);
      await submitInstruction(page, "Make the selected text much shorter while keeping the meaning.");

      await expect(page.locator(".chat-event-icon.done")).toBeVisible({ timeout: 80_000 });
      await page.waitForTimeout(500);

      const updated = readTmpFile(FILE);
      // File must have changed from original
      expect(updated).not.toBe(ORIGINAL);
      // The second paragraph must be untouched
      expect(updated).toContain("Keep this paragraph exactly as is.");
      // The updated paragraph should be shorter than the original one
      const originalLineLen = ORIGINAL.split("\n")[2].length;
      const updatedLines = updated.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.includes("Keep this"));
      const updatedLineLen = updatedLines[0]?.length ?? originalLineLen;
      expect(updatedLineLen).toBeLessThan(originalLineLen);
    } finally {
      cleanupTmpFile(FILE);
    }
  });

  test("Claude capitalises every word when instructed", async ({ page }) => {
    const FILE = "tmp-claude-capitalize.md";
    const ORIGINAL = `# Capitalize Test\n\nthe quick brown fox jumps over the lazy dog.\n\nDo not touch this line.\n`;
    createTmpFile(FILE, ORIGINAL);

    try {
      await openFile(page, FILE);
      await submitInstruction(page, "Capitalize the first letter of every word in the selected text.");

      await expect(page.locator(".chat-event-icon.done")).toBeVisible({ timeout: 80_000 });
      await page.waitForTimeout(500);

      const updated = readTmpFile(FILE);
      expect(updated).not.toBe(ORIGINAL);
      // Should NOT still contain the all-lowercase version
      expect(updated).not.toContain("the quick brown fox");
      // Preserved line must survive
      expect(updated).toContain("Do not touch this line.");
    } finally {
      cleanupTmpFile(FILE);
    }
  });

  test("file reloads in browser after Claude edits it", async ({ page }) => {
    const FILE = "tmp-claude-reload.md";
    const ORIGINAL = `# Reload Test\n\nOriginal browser text.\n`;
    createTmpFile(FILE, ORIGINAL);

    try {
      await openFile(page, FILE);

      // Capture the initial rendered text
      const initialDocText = await page.locator("#doc").textContent();

      await submitInstruction(page, "Replace 'Original' with 'Updated' in the selected text.");

      // Wait for Claude to finish
      await expect(page.locator(".chat-event-icon.done")).toBeVisible({ timeout: 80_000 });

      // The app reloads the file via WebSocket done → loadFile(); wait for
      // the rendered text to change.
      await expect(page.locator("#doc")).not.toHaveText(initialDocText!, { timeout: 10_000 });

      const newDocText = await page.locator("#doc").textContent();
      expect(newDocText).toContain("Updated");
    } finally {
      cleanupTmpFile(FILE);
    }
  });
});
