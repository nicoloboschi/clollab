import path from "path";
import { watch, mkdirSync, writeFileSync, readFileSync } from "fs";
import type { ServerWebSocket } from "bun";
import { getMarkdownFiles, readMarkdownFile } from "./files";
import { applyComment } from "./claude";

const PUBLIC_DIR = path.join(import.meta.dir, "../public");
const PORT = 3333;

type WSData = Record<string, never>;

function broadcast(clients: Set<ServerWebSocket<WSData>>, data: object) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    try { client.send(msg); } catch { /* skip closed */ }
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const full = path.resolve(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(path.resolve(PUBLIC_DIR))) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(full);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file);
}

export function startServer(cwd: string) {
  const clients = new Set<ServerWebSocket<WSData>>();

  watch(cwd, { recursive: true }, (_event, filename) => {
    if (filename?.endsWith(".md")) {
      broadcast(clients, { type: "reload", file: filename });
    }
  });

  Bun.serve<WSData>({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname === "/api/files") {
        return Response.json(getMarkdownFiles(cwd));
      }

      if (url.pathname === "/api/file") {
        const filePath = url.searchParams.get("path");
        if (!filePath) return new Response("Missing path", { status: 400 });
        try {
          const content = readMarkdownFile(cwd, filePath);
          return new Response(content, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/edit") {
        const body = await req.json() as { file?: string; oldText?: string; newText?: string };
        const { file, oldText, newText } = body;
        if (!file || oldText === undefined || newText === undefined) {
          return new Response("Missing fields", { status: 400 });
        }
        const resolved = path.resolve(cwd, file);
        if (!resolved.startsWith(path.resolve(cwd) + path.sep)) {
          return new Response("Path traversal not allowed", { status: 403 });
        }
        try {
          const raw = readFileSync(resolved, "utf-8");
          const updated = raw.replace(oldText, newText);
          if (updated === raw) return new Response("Text not found", { status: 404 });
          writeFileSync(resolved, updated);
          return new Response("OK");
        } catch {
          return new Response("Error", { status: 500 });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/new-file") {
        const body = await req.json() as { path?: string };
        const filePath = body.path?.trim();
        if (!filePath) return new Response("Missing path", { status: 400 });
        if (!filePath.endsWith(".md")) return new Response("Must be a .md file", { status: 400 });
        const resolved = path.resolve(cwd, filePath);
        if (!resolved.startsWith(path.resolve(cwd) + path.sep)) {
          return new Response("Path traversal not allowed", { status: 403 });
        }
        try {
          mkdirSync(path.dirname(resolved), { recursive: true });
          writeFileSync(resolved, `# ${path.basename(filePath, ".md")}\n`, { flag: "wx" });
          return Response.json({ path: filePath });
        } catch (e: any) {
          if (e.code === "EEXIST") return new Response("File already exists", { status: 409 });
          return new Response(String(e), { status: 500 });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/comment") {
        const body = await req.json() as { file?: string; selection?: string; comment?: string };
        const { file, selection, comment } = body;
        if (!file || selection === undefined || !comment) {
          return new Response("Missing fields", { status: 400 });
        }

        broadcast(clients, { type: "processing", file });

        applyComment(cwd, file, selection, comment,
          (event) => broadcast(clients, { type: "stream", file, ...event }),
          () => broadcast(clients, { type: "done", file }),
          (err) => broadcast(clients, { type: "error", file, error: err })
        );

        return new Response("OK");
      }

      return serveStatic(url.pathname);
    },
    websocket: {
      open(ws) { clients.add(ws); },
      close(ws) { clients.delete(ws); },
      message() {},
    },
  });

  console.log(`\n  http://localhost:${PORT}\n`);

  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  Bun.spawn([opener, `http://localhost:${PORT}`]);
}
