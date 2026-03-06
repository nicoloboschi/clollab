#!/usr/bin/env bun
import path from "path";
import { startServer } from "./server";

// Allow the Agent SDK to spawn `claude` even when clollab itself
// is launched from inside a Claude Code session (e.g. during development).
delete process.env.CLAUDECODE;

const dir = process.argv[2] ?? ".";
const cwd = path.resolve(process.cwd(), dir);

console.log(`clollab → ${cwd}`);
startServer(cwd);
