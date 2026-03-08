#!/usr/bin/env bun
import path from "path";
import { startServer } from "./server";

// Allow the Agent SDK to spawn `claude` even when clollab itself
// is launched from inside a Claude Code session (e.g. during development).
// Strip all Claude Code session markers so the spawned subprocess is treated
// as a fresh SDK process rather than a nested Claude Code instance.
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

const dir = process.argv[2] ?? ".";
const cwd = path.resolve(process.cwd(), dir);

console.log(`clollab → ${cwd}`);
startServer(cwd);
