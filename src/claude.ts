import { query } from "@anthropic-ai/claude-agent-sdk";
import { readMarkdownFile } from "./files";

export type StreamEvent =
  | { kind: "tool"; tool: string; path?: string }
  | { kind: "text"; text: string }
  | { kind: "result"; text: string };

export function buildPrompt(filePath: string, selectedText: string, comment: string): string {
  if (!selectedText) {
    return `You are editing the markdown file "${filePath}".

The user's instruction: "${comment}"

Apply the instruction to the file. Modify the file directly. Only change what the instruction asks for — keep all other content unchanged.`;
  }
  return `You are editing the markdown file "${filePath}".

The user selected this text:
"""
${selectedText}
"""

Their instruction: "${comment}"

Apply the instruction to the selected text. Modify the file directly. Only change what the instruction asks for — keep all other content unchanged.`;
}

export async function applyComment(
  cwd: string,
  filePath: string,
  selectedText: string,
  comment: string,
  onStream: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  // Validate before touching the SDK
  let fileContent: string;
  try {
    fileContent = readMarkdownFile(cwd, filePath);
  } catch (e) {
    onError(`Could not read file: ${e}`);
    return;
  }

  if (selectedText && !fileContent.includes(selectedText)) {
    onError(`Selected text not found in ${filePath}`);
    return;
  }

  const prompt = buildPrompt(filePath, selectedText, comment);

  // Build a clean environment: strip Claude Code session markers so the SDK
  // subprocess is never treated as a nested Claude Code instance.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,
        env,
        allowedTools: ["Read", "Edit", "Write"],
        permissionMode: "acceptEdits",
        hooks: {
          PreToolUse: [{
            matcher: ".*",
            hooks: [async (input: any) => {
              const tool: string = input.tool_name ?? "tool";
              const path: string | undefined =
                input.tool_input?.file_path ??
                input.tool_input?.path ??
                undefined;
              onStream({ kind: "tool", tool, path });
              return {};
            }],
          }],
        },
      },
    })) {
      const msg = message as any;

      if ("result" in msg && typeof msg.result === "string" && msg.result.trim()) {
        onStream({ kind: "result", text: msg.result.trim() });
        continue;
      }

      if (msg.type === "system") continue;

      // Extract text blocks from assistant messages
      const content: any[] =
        Array.isArray(msg.content) ? msg.content :
        Array.isArray(msg.message?.content) ? msg.message.content : [];

      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          onStream({ kind: "text", text: block.text.trim() });
        }
      }
    }
    onDone();
  } catch (err) {
    onError(String(err));
  }
}
