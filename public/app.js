// State
let currentFile = null;
let pendingSelection = null;
let isProcessing = false;
let currentClaudeMsg = null; // the active .chat-msg-claude div being streamed into

// WebSocket
const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "processing") {
    isProcessing = true;
  }

  if (msg.type === "stream") {
    if (!currentClaudeMsg) {
      currentClaudeMsg = addClaudeMessage();
    }
    appendToClaudeMsg(currentClaudeMsg, msg);
  }

  if (msg.type === "done") {
    isProcessing = false;
    if (!currentClaudeMsg) currentClaudeMsg = addClaudeMessage();
    appendToClaudeMsg(currentClaudeMsg, { kind: "done" });
    currentClaudeMsg = null;
    if (currentFile) loadFile(currentFile, false);
  }

  if (msg.type === "reload") {
    if (currentFile && (msg.file === currentFile || msg.file?.endsWith(currentFile))) {
      loadFile(currentFile, false);
    }
  }

  if (msg.type === "error") {
    isProcessing = false;
    currentClaudeMsg = null;
    showStatus(`Error: ${msg.error}`, true);
    setTimeout(hideStatus, 6000);
  }
};

// ── File tree ──────────────────────────────────────────────

async function loadFiles() {
  const res = await fetch("/api/files");
  const files = await res.json();
  renderTree(files);
  if (files.length > 0) loadFile(files[0]);
}

function renderTree(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] ??= {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = f;
  }
  const container = document.getElementById("file-tree");
  container.innerHTML = "";
  container.appendChild(buildUl(root));
}

function buildUl(node) {
  const ul = document.createElement("ul");
  for (const [key, val] of Object.entries(node)) {
    const li = document.createElement("li");
    if (typeof val === "string") {
      const btn = document.createElement("button");
      btn.className = "file-item";
      btn.textContent = key;
      btn.dataset.path = val;
      btn.onclick = () => loadFile(val);
      li.appendChild(btn);
    } else {
      const label = document.createElement("div");
      label.className = "dir-label";
      label.textContent = key;
      li.appendChild(label);
      li.appendChild(buildUl(val));
    }
    ul.appendChild(li);
  }
  return ul;
}

// ── File loading ───────────────────────────────────────────

async function loadFile(filePath, updateActive = true) {
  currentFile = filePath;

  if (updateActive) {
    document.querySelectorAll(".file-item").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.file-item[data-path="${CSS.escape(filePath)}"]`);
    if (btn) btn.classList.add("active");
  }

  document.title = `${filePath} — clollab`;

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    document.getElementById("doc").innerHTML = marked.parse(md);
  } catch (err) {
    document.getElementById("doc").innerHTML = `<p style="color:#ef4444">Failed to load file: ${err.message}</p>`;
  }
}

// ── Claude chat panel ──────────────────────────────────────

function addUserMessage(selection, instruction) {
  const msgs = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-msg-user";
  if (selection) {
    const sel = document.createElement("div");
    sel.className = "chat-msg-selection";
    sel.textContent = `"${selection}"`;
    div.appendChild(sel);
  }
  const text = document.createElement("div");
  text.textContent = instruction;
  div.appendChild(text);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addClaudeMessage() {
  const msgs = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-msg-claude";
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function appendToClaudeMsg(container, msg) {
  const msgs = document.getElementById("chat-messages");
  const line = document.createElement("div");
  line.className = "chat-event";

  const icon = document.createElement("span");
  icon.className = `chat-event-icon ${msg.kind}`;

  const content = document.createElement("span");
  content.className = "chat-event-content";

  if (msg.kind === "tool") {
    icon.textContent = "▶";
    const name = document.createElement("span");
    name.textContent = msg.tool;
    const path = document.createElement("span");
    path.className = "dim";
    path.textContent = msg.path ? `  ${msg.path}` : "";
    content.appendChild(name);
    content.appendChild(path);
  } else if (msg.kind === "text") {
    icon.textContent = "·";
    content.textContent = msg.text.length > 120 ? msg.text.slice(0, 120) + "…" : msg.text;
  } else if (msg.kind === "result") {
    icon.textContent = "◆";
    content.textContent = msg.text.length > 120 ? msg.text.slice(0, 120) + "…" : msg.text;
  } else if (msg.kind === "done") {
    icon.textContent = "✓";
    icon.className = "chat-event-icon done";
    content.textContent = "Changes applied";
  }

  line.appendChild(icon);
  line.appendChild(content);
  container.appendChild(line);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Shift+select → populate chat input ────────────────────

document.addEventListener("mouseup", (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !currentFile) return;
  const text = sel.toString().trim();
  if (!text || !e.shiftKey) return;

  e.preventDefault();
  pendingSelection = text;

  const preview = document.getElementById("chat-selection");
  preview.textContent = `"${text}"`;
  preview.classList.remove("hidden");

  setTimeout(() => {
    document.getElementById("chat-input").focus();
  }, 0);
});

// ── Chat send ──────────────────────────────────────────────

async function sendChat() {
  const input = document.getElementById("chat-input");
  const comment = input.value.trim();
  if (!comment || !currentFile) return;

  const selection = pendingSelection;
  const selectionPreview = document.getElementById("chat-selection");

  // Clear input state
  input.value = "";
  selectionPreview.classList.add("hidden");
  pendingSelection = null;

  // Add user message to chat
  addUserMessage(selection, comment);

  // Send to server
  await fetch("/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: currentFile, selection: selection ?? "", comment }),
  });
}

document.getElementById("chat-send").onclick = sendChat;

document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChat();
});

// ── Click → inline edit (always on) ──────────────────────

document.getElementById("doc").addEventListener("click", (e) => {
  if (isProcessing) return; // block edit while Claude is working
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;

  const el = e.target.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote");
  if (!el || el.contentEditable === "true") return;

  const originalText = el.textContent;
  el.contentEditable = "true";
  el.classList.add("editing");
  el.focus();

  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (range) { window.getSelection().removeAllRanges(); window.getSelection().addRange(range); }

  function commit() {
    const newText = el.textContent;
    el.contentEditable = "false";
    el.classList.remove("editing");
    if (newText !== originalText && currentFile) {
      fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: currentFile, oldText: originalText, newText }),
      });
    }
  }

  el.addEventListener("blur", commit, { once: true });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      el.textContent = originalText;
      el.contentEditable = "false";
      el.classList.remove("editing");
      ev.stopPropagation();
    }
  });
});

// ── Status bar ─────────────────────────────────────────────

function showStatus(text, isError = false) {
  const bar = document.getElementById("status-bar");
  bar.classList.remove("hidden", "error");
  if (isError) bar.classList.add("error");
  document.getElementById("status-text").textContent = text;
}

function hideStatus() {
  document.getElementById("status-bar").classList.add("hidden");
}

// ── New file ───────────────────────────────────────────────

document.getElementById("new-file-btn").onclick = () => {
  document.getElementById("new-file-overlay").classList.remove("hidden");
  document.getElementById("new-file-input").value = "";
  document.getElementById("new-file-input").focus();
};

document.getElementById("new-file-cancel").onclick = closeNewFileDialog;

document.getElementById("new-file-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeNewFileDialog();
});

document.getElementById("new-file-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitNewFile();
  if (e.key === "Escape") closeNewFileDialog();
});

document.getElementById("new-file-submit").onclick = submitNewFile;

function closeNewFileDialog() {
  document.getElementById("new-file-overlay").classList.add("hidden");
}

async function submitNewFile() {
  let filePath = document.getElementById("new-file-input").value.trim();
  if (!filePath) return;
  if (!filePath.endsWith(".md")) filePath += ".md";
  const res = await fetch("/api/new-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  if (res.ok) {
    closeNewFileDialog();
    await loadFiles();
    loadFile(filePath);
  } else {
    const msg = await res.text();
    document.getElementById("new-file-input").setCustomValidity(msg);
    document.getElementById("new-file-input").reportValidity();
  }
}

// ── Comet cursor ──────────────────────────────────────────

const TRAIL_COUNT = 10;
const cursorHead = document.getElementById("cursor-head");
const trailEls = [];

for (let i = 0; i < TRAIL_COUNT; i++) {
  const el = document.createElement("div");
  el.className = "cursor-trail";
  const t = i / TRAIL_COUNT;
  const size = Math.round(8 * (1 - t * 0.85));
  const opacity = Math.pow(1 - t, 1.6) * 0.75;
  el.style.cssText = `width:${size}px;height:${size}px;opacity:${opacity}`;
  document.body.appendChild(el);
  trailEls.push({ el, x: -100, y: -100 });
}

let mouseX = -100, mouseY = -100;
let headX = -100, headY = -100;

document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const isInput = over?.matches('input, textarea, select, [contenteditable="true"]');
  cursorHead.style.opacity = isInput ? "0" : "1";
  trailEls.forEach(t => t.el.style.opacity = isInput ? "0" : null);
});

document.addEventListener("mouseleave", () => {
  cursorHead.style.opacity = "0";
  trailEls.forEach(t => t.el.style.opacity = "0");
});
document.addEventListener("mouseenter", () => {
  cursorHead.style.opacity = "1";
  trailEls.forEach(t => t.el.style.opacity = null);
});

// shift key swaps cursor color to preview Claude mode
function setCursorMode(claude) {
  cursorHead.classList.toggle("claude-cursor", claude);
  trailEls.forEach(t => t.el.classList.toggle("claude-cursor", claude));
}
document.addEventListener("keydown", (e) => { if (e.key === "Shift") setCursorMode(true); });
document.addEventListener("keyup",   (e) => { if (e.key === "Shift") setCursorMode(false); });

(function animateCursor() {
  headX += (mouseX - headX) * 0.45;
  headY += (mouseY - headY) * 0.45;
  cursorHead.style.left = headX + "px";
  cursorHead.style.top = headY + "px";

  let px = headX, py = headY;
  trailEls.forEach((dot) => {
    dot.x += (px - dot.x) * 0.35;
    dot.y += (py - dot.y) * 0.35;
    dot.el.style.left = dot.x + "px";
    dot.el.style.top = dot.y + "px";
    px = dot.x; py = dot.y;
  });
  requestAnimationFrame(animateCursor);
})();

// ── Init ───────────────────────────────────────────────────
loadFiles();
