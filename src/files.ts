import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export function getMarkdownFiles(cwd: string): string[] {
  const files: string[] = [];

  function walk(dir: string, rel: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = path.join(dir, entry);
      const rel2 = rel ? `${rel}/${entry}` : entry;
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, rel2);
        } else if (entry.endsWith(".md")) {
          files.push(rel2);
        }
      } catch {
        // skip inaccessible entries
      }
    }
  }

  walk(cwd, "");
  return files.sort();
}

export function readMarkdownFile(cwd: string, filePath: string): string {
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(path.resolve(cwd) + path.sep) && resolved !== path.resolve(cwd)) {
    throw new Error("Path traversal not allowed");
  }
  return readFileSync(resolved, "utf-8");
}
