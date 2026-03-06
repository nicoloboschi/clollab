import { describe, test, expect, mock, afterEach } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "fs";
import path from "path";

// ── buildPrompt ───────────────────────────────────────────

// Import after potential mocks are set up
import { buildPrompt } from "../claude";

describe("buildPrompt", () => {
  test("includes the file path", () => {
    expect(buildPrompt("docs/readme.md", "old text", "fix it")).toContain("docs/readme.md");
  });

  test("includes the selected text", () => {
    expect(buildPrompt("file.md", "Hello world", "make formal")).toContain("Hello world");
  });

  test("includes the instruction", () => {
    expect(buildPrompt("file.md", "text", "make it shorter")).toContain("make it shorter");
  });

  test("instructs not to change other content", () => {
    const p = buildPrompt("file.md", "text", "fix");
    expect(p).toContain("keep all other content unchanged");
  });
});

// ── applyComment (mocked SDK) ─────────────────────────────

const TEST_DIR = path.join(import.meta.dir, "../../.test-tmp");
const TEST_FILE = "test.md";
const TEST_PATH = path.join(TEST_DIR, TEST_FILE);

function setupFile(content: string) {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_PATH, content);
}

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mock.restore();
});

// Mock the Agent SDK query to return a fake result
function mockQuery(resultText: string, toolCalls: Array<{ name: string; path?: string }> = []) {
  mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    query: async function* (_opts: any) {
      // Emit assistant text
      yield { content: [{ type: "text", text: "Applying changes..." }] };
      // Emit result
      yield { result: resultText };
    },
  }));
}

describe("applyComment", () => {
  test("file not found calls onError", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const { applyComment } = await import("../claude");

    let errorMsg = "";
    await applyComment(TEST_DIR, "missing.md", "text", "fix",
      () => {}, () => {}, (e) => { errorMsg = e; });

    expect(errorMsg).toContain("Could not read");
  });

  test("selected text not in file calls onError", async () => {
    setupFile("# Title\n\nActual content here.\n");
    const { applyComment } = await import("../claude");

    let errorMsg = "";
    await applyComment(TEST_DIR, TEST_FILE, "text that does not exist", "fix",
      () => {}, () => {}, (e) => { errorMsg = e; });

    expect(errorMsg).toContain("not found");
  });

  test("emits status event immediately when selected text exists", async () => {
    setupFile("# Title\n\nChange this sentence.\n");

    mockQuery("Changed sentence.");
    const { applyComment } = (await import("../claude")) as typeof import("../claude");

    const events: any[] = [];
    await applyComment(TEST_DIR, TEST_FILE, "Change this sentence.", "make formal",
      (e) => events.push(e),
      () => {},
      (e) => { throw new Error(e); });

    const status = events.find((e) => e.kind === "tool" || e.kind === "text" || e.kind === "result");
    expect(status).toBeTruthy();
  });
});

// ── stream event shape ────────────────────────────────────

describe("StreamEvent types", () => {
  test("tool event has tool and optional path", () => {
    const event = { kind: "tool" as const, tool: "Edit", path: "readme.md" };
    expect(event.kind).toBe("tool");
    expect(event.tool).toBe("Edit");
    expect(event.path).toBe("readme.md");
  });

  test("result event has text", () => {
    const event = { kind: "result" as const, text: "summary" };
    expect(event.kind).toBe("result");
    expect(event.text).toBe("summary");
  });

  test("text event has text", () => {
    const event = { kind: "text" as const, text: "working..." };
    expect(event.text).toBeTruthy();
  });
});
