import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as storage from "./storage";
import { RawEvent } from "./types";

export interface AgentSource {
  id: string;
  name: string;
  dir: string;
  found: boolean;
  sessionCount: number;
  oldest?: string; // ISO date
  newest?: string; // ISO date
}

export interface ImportOptions {
  agentId: string;
  cutoffDays: number; // 1, 7, 30, 90
}

export interface ImportProgress {
  agentId: string;
  total: number;
  processed: number;
  imported: number;
  dates: string[];
}

export interface SessionPreview {
  id: string;
  date: string;      // YYYY-MM-DD
  project?: string;
  firstMessage: string; // first user message, truncated
}

const AGENT_DEFS: { id: string; name: string; relDir: string }[] = [
  { id: "claude_code", name: "Claude Code", relDir: ".claude" },
  { id: "codex", name: "Codex", relDir: ".codex" },
  { id: "gemini", name: "Gemini", relDir: ".gemini" },
  { id: "cursor", name: "Cursor", relDir: ".cursor" },
  { id: "openclaw", name: "OpenClaw", relDir: ".openclaw" },
  { id: "opencode", name: "OpenCode", relDir: ".opencode" },
];

// ── Scanning ──

export async function scanAgentSources(cutoffDays?: number): Promise<AgentSource[]> {
  const home = os.homedir();
  const cutoffMs = cutoffDays ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000 : 0;
  const results: AgentSource[] = [];

  for (const def of AGENT_DEFS) {
    const dir = path.join(home, def.relDir);
    const source: AgentSource = { id: def.id, name: def.name, dir, found: false, sessionCount: 0 };

    try {
      await fs.access(dir);
      source.found = true;

      const allSessions = await listSessionFiles(def.id, dir);
      const sessions = cutoffMs > 0
        ? allSessions.filter((s) => s.mtime >= cutoffMs)
        : allSessions;
      source.sessionCount = sessions.length;
      if (sessions.length > 0) {
        const sorted = sessions.sort((a, b) => a.mtime - b.mtime);
        source.oldest = new Date(sorted[0].mtime).toISOString().slice(0, 10);
        source.newest = new Date(sorted[sorted.length - 1].mtime).toISOString().slice(0, 10);
      }
    } catch {
      // dir doesn't exist
    }

    results.push(source);
  }

  return results;
}

// ── Session file discovery per agent ──

interface SessionFile {
  path: string;
  mtime: number;
  date: string; // YYYY-MM-DD
}

async function listSessionFiles(agentId: string, baseDir: string): Promise<SessionFile[]> {
  switch (agentId) {
    case "claude_code": return listClaudeCodeSessions(baseDir);
    case "codex": return listCodexSessions(baseDir);
    case "gemini": return listGeminiSessions(baseDir);
    case "cursor": return listCursorSessions(baseDir);
    case "openclaw": return listOpenClawSessions(baseDir);
    case "opencode": return listOpenCodeSessions(baseDir);
    default: return [];
  }
}

async function listClaudeCodeSessions(baseDir: string): Promise<SessionFile[]> {
  const projectsDir = path.join(baseDir, "projects");
  const results: SessionFile[] = [];
  try {
    const projects = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const proj of projects) {
      if (!proj.isDirectory()) continue;
      const projPath = path.join(projectsDir, proj.name);
      try {
        const files = await fs.readdir(projPath);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const filePath = path.join(projPath, file);
          const stat = await fs.stat(filePath);
          results.push({
            path: filePath,
            mtime: stat.mtimeMs,
            date: new Date(stat.mtimeMs).toISOString().slice(0, 10),
          });
        }
      } catch { continue; }
    }
  } catch { /* no projects dir */ }
  return results;
}

async function listCodexSessions(baseDir: string): Promise<SessionFile[]> {
  // ~/.codex/sessions/YYYY/MM/DD/*.jsonl
  const sessionsDir = path.join(baseDir, "sessions");
  const results: SessionFile[] = [];
  try {
    await walkDir(sessionsDir, (filePath, stat) => {
      if (filePath.endsWith(".jsonl")) {
        results.push({
          path: filePath,
          mtime: stat.mtimeMs,
          date: new Date(stat.mtimeMs).toISOString().slice(0, 10),
        });
      }
    });
  } catch { /* no sessions dir */ }
  return results;
}

async function listGeminiSessions(baseDir: string): Promise<SessionFile[]> {
  // ~/.gemini/tmp/{hash}/chats/session-*.json
  const tmpDir = path.join(baseDir, "tmp");
  const results: SessionFile[] = [];
  try {
    const hashes = await fs.readdir(tmpDir, { withFileTypes: true });
    for (const h of hashes) {
      if (!h.isDirectory() || h.name === "bin") continue;
      const chatsDir = path.join(tmpDir, h.name, "chats");
      try {
        const files = await fs.readdir(chatsDir);
        for (const file of files) {
          if (!file.startsWith("session-") || !file.endsWith(".json")) continue;
          const filePath = path.join(chatsDir, file);
          const stat = await fs.stat(filePath);
          results.push({
            path: filePath,
            mtime: stat.mtimeMs,
            date: new Date(stat.mtimeMs).toISOString().slice(0, 10),
          });
        }
      } catch { continue; }
    }
  } catch { /* no tmp dir */ }
  return results;
}

async function listCursorSessions(baseDir: string): Promise<SessionFile[]> {
  // ~/.cursor/chats/{hash}/{uuid}/store.db — SQLite, skip for now
  // Just count the chat directories as "sessions"
  const chatsDir = path.join(baseDir, "chats");
  const results: SessionFile[] = [];
  try {
    const groups = await fs.readdir(chatsDir, { withFileTypes: true });
    for (const group of groups) {
      if (!group.isDirectory()) continue;
      const groupDir = path.join(chatsDir, group.name);
      const sessions = await fs.readdir(groupDir, { withFileTypes: true });
      for (const sess of sessions) {
        if (!sess.isDirectory()) continue;
        const dbPath = path.join(groupDir, sess.name, "store.db");
        try {
          const stat = await fs.stat(dbPath);
          results.push({
            path: dbPath,
            mtime: stat.mtimeMs,
            date: new Date(stat.mtimeMs).toISOString().slice(0, 10),
          });
        } catch { continue; }
      }
    }
  } catch { /* no chats dir */ }
  return results;
}

async function listOpenClawSessions(baseDir: string): Promise<SessionFile[]> {
  // ~/.openclaw/logs/*.log — log files as proxy for sessions
  const logsDir = path.join(baseDir, "logs");
  const results: SessionFile[] = [];
  try {
    const files = await fs.readdir(logsDir);
    for (const file of files) {
      if (!file.endsWith(".log")) continue;
      const filePath = path.join(logsDir, file);
      const stat = await fs.stat(filePath);
      results.push({
        path: filePath,
        mtime: stat.mtimeMs,
        date: new Date(stat.mtimeMs).toISOString().slice(0, 10),
      });
    }
  } catch { /* no logs dir */ }
  return results;
}

async function listOpenCodeSessions(baseDir: string): Promise<SessionFile[]> {
  // OpenCode doesn't appear to store session files in the standard way
  return [];
}

// ── Session Previews ──

export async function listAgentSessionPreviews(
  agentId: string,
  cutoffDays?: number,
): Promise<SessionPreview[]> {
  const home = os.homedir();
  const def = AGENT_DEFS.find((d) => d.id === agentId);
  if (!def) return [];

  const dir = path.join(home, def.relDir);
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const allSessions = await listSessionFiles(agentId, dir);
  const cutoffMs = cutoffDays ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000 : 0;
  const sessions = cutoffMs > 0
    ? allSessions.filter((s) => s.mtime >= cutoffMs)
    : allSessions;

  // Sort newest first, cap at 50
  const sorted = sessions.sort((a, b) => b.mtime - a.mtime).slice(0, 50);

  const previews: SessionPreview[] = [];
  for (const sess of sorted) {
    const preview = await extractSessionPreview(agentId, sess);
    if (preview) previews.push(preview);
  }
  return previews;
}

async function extractSessionPreview(
  agentId: string,
  session: SessionFile,
): Promise<SessionPreview | null> {
  try {
    switch (agentId) {
      case "claude_code":
      case "codex":
        return extractJsonlPreview(agentId, session);
      case "gemini":
        return extractGeminiPreview(session);
      case "cursor":
        return { id: session.path, date: session.date, firstMessage: "(Cursor session — SQLite)" };
      case "openclaw":
        return extractOpenClawPreview(session);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function extractJsonlPreview(agentId: string, session: SessionFile): Promise<SessionPreview | null> {
  // Read only first 32KB to find the first user message
  const fd = await fs.open(session.path, "r");
  try {
    const buf = Buffer.alloc(32768);
    const { bytesRead } = await fd.read(buf, 0, 32768, 0);
    const chunk = buf.toString("utf-8", 0, bytesRead);
    const lines = chunk.split("\n").filter(Boolean);

    let firstMsg = "";
    let project: string | undefined;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);

        // Extract cwd for project name (from any line that has it)
        if (!project) {
          const cwd = obj.cwd || obj.payload?.cwd;
          if (cwd) project = path.basename(cwd);
        }

        // Skip if we already found the first message
        if (firstMsg) continue;

        // Claude Code: type "user" with message.content
        if (obj.type === "user" && obj.message?.content != null) {
          firstMsg = extractContent(obj.message.content);
          continue;
        }

        // Codex: event_msg with user_message payload (the actual user input)
        if (obj.type === "event_msg" && obj.payload?.type === "user_message") {
          firstMsg = extractContent(obj.payload.message);
          continue;
        }

        // Codex: session_meta for cwd (already handled above, skip other response_items)
        if (obj.type === "response_item" || obj.type === "event_msg") {
          continue;
        }

        // Generic: role "user" with direct content
        if (obj.role === "user") {
          firstMsg = extractContent(obj.content) || extractContent(obj.text);
          continue;
        }

        // Nested message format
        if (obj.message?.role === "user") {
          firstMsg = extractContent(obj.message.content);
          continue;
        }
      } catch { continue; }
    }

    // Fallback project name from directory
    if (!project) {
      if (agentId === "claude_code") {
        const projDir = path.basename(path.dirname(session.path));
        const segments = projDir.split("-").filter(Boolean);
        project = segments[segments.length - 1] || projDir;
      } else if (agentId === "codex") {
        try {
          const first = JSON.parse(lines[0]);
          if (first.payload?.cwd) project = path.basename(first.payload.cwd);
        } catch { /* skip */ }
      }
    }

    if (!firstMsg) firstMsg = "(No user message found)";

    return {
      id: session.path,
      date: session.date,
      project,
      firstMessage: firstMsg.slice(0, 200),
    };
  } finally {
    await fd.close();
  }
}

function extractContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((c: any) => (c?.type === "text" || c?.type === "input_text" || c?.type === "output_text") && typeof c.text === "string")
      .map((c: any) => c.text)
      .join(" ")
      .trim();
    if (text) return text;
    // Also handle plain string array entries
    for (const part of content) {
      if (typeof part === "string") return part.trim();
    }
  }
  return "";
}

async function extractGeminiPreview(session: SessionFile): Promise<SessionPreview | null> {
  // Read first 32KB
  const fd = await fs.open(session.path, "r");
  try {
    const buf = Buffer.alloc(32768);
    const { bytesRead } = await fd.read(buf, 0, 32768, 0);
    const chunk = buf.toString("utf-8", 0, bytesRead);

    // Try to parse — may be truncated, that's ok for preview
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(chunk);
    } catch {
      // Truncated JSON, try to find first user message in raw text
      const match = chunk.match(/"role"\s*:\s*"user"[^}]*"content"\s*:\s*"([^"]{1,200})"/);
      return {
        id: session.path,
        date: session.date,
        firstMessage: match?.[1] || "(Could not parse session)",
      };
    }

    const messages = (data.messages || data.history || []) as Record<string, unknown>[];
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = typeof msg.content === "string"
          ? msg.content
          : (msg.parts as { text?: string }[] | undefined)?.map((p) => p.text).filter(Boolean).join(" ") || "";
        if (text) {
          return { id: session.path, date: session.date, firstMessage: text.slice(0, 200) };
        }
      }
    }
    return { id: session.path, date: session.date, firstMessage: "(No user message found)" };
  } finally {
    await fd.close();
  }
}

async function extractOpenClawPreview(session: SessionFile): Promise<SessionPreview | null> {
  const fd = await fs.open(session.path, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(buf, 0, 4096, 0);
    const chunk = buf.toString("utf-8", 0, bytesRead);
    const firstLine = chunk.split("\n")[0] || "(Empty log)";
    return { id: session.path, date: session.date, firstMessage: firstLine.slice(0, 200) };
  } finally {
    await fd.close();
  }
}

// ── Importing ──

export async function runImport(
  options: ImportOptions,
  baseDir?: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const home = os.homedir();
  const def = AGENT_DEFS.find((d) => d.id === options.agentId);
  if (!def) throw new Error(`Unknown agent: ${options.agentId}`);

  const agentDir = path.join(home, def.relDir);
  const sessions = await listSessionFiles(options.agentId, agentDir);

  const cutoffMs = Date.now() - options.cutoffDays * 24 * 60 * 60 * 1000;
  const filtered = sessions.filter((s) => s.mtime >= cutoffMs);

  // Cap at 100 sessions per import to avoid overwhelming
  const batch = filtered.sort((a, b) => b.mtime - a.mtime).slice(0, 100);

  const importedDates = new Set<string>();
  const progress: ImportProgress = {
    agentId: options.agentId,
    total: batch.length,
    processed: 0,
    imported: 0,
    dates: [],
  };

  for (const session of batch) {
    try {
      const imported = await importSession(options.agentId, session, baseDir);
      if (imported) {
        progress.imported++;
        importedDates.add(session.date);
      }
    } catch {
      // skip failed sessions
    }
    progress.processed++;
    progress.dates = Array.from(importedDates).sort();
    onProgress?.(progress);
  }

  return progress;
}

async function importSession(agentId: string, session: SessionFile, baseDir?: string): Promise<boolean> {
  switch (agentId) {
    case "claude_code":
    case "codex":
      return importJsonlSession(agentId, session, baseDir);
    case "gemini":
      return importGeminiSession(session, baseDir);
    default:
      // cursor (sqlite), openclaw (sqlite), opencode — not yet supported for import
      return false;
  }
}

async function importJsonlSession(agentId: string, session: SessionFile, baseDir?: string): Promise<boolean> {
  const summary = await extractSessionSummary(session.path);
  if (!summary || summary === "Empty or unreadable session." || summary === "Could not read session file.") {
    return false;
  }

  // Derive project name from path
  let project = "unknown";
  if (agentId === "claude_code") {
    // path: ~/.claude/projects/{encoded-project-path}/{uuid}.jsonl
    const projDir = path.basename(path.dirname(session.path));
    project = projDir.split("-").slice(3).join("/") || projDir; // decode -Users-muqsit-... to muqsit/...
  } else if (agentId === "codex") {
    // Extract cwd from session_meta if possible, otherwise use date
    project = await extractCodexProject(session.path) || "codex-session";
  }

  const event: RawEvent = {
    source: agentId,
    timestamp: new Date(session.mtime).toISOString(),
    kind: "session",
    data: {
      title: `${agentId === "claude_code" ? "Claude Code" : "Codex"} session: ${project}`,
      summary: summary.slice(0, 2000),
      project,
      imported: true,
    },
  };

  await storage.appendStagingEvent(session.date, event, baseDir);
  return true;
}

async function extractCodexProject(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const firstLine = raw.split("\n")[0];
    if (firstLine) {
      const parsed = JSON.parse(firstLine);
      if (parsed.payload?.cwd) {
        return path.basename(parsed.payload.cwd);
      }
    }
  } catch { /* skip */ }
  return null;
}

async function importGeminiSession(session: SessionFile, baseDir?: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(session.path, "utf-8");
    const data = JSON.parse(raw);

    // Gemini sessions are JSON with messages array
    const messages = data.messages || data.history || [];
    if (messages.length === 0) return false;

    const summaryParts: string[] = [];
    let count = 0;
    for (const msg of messages) {
      if (count >= 10) break;
      const role = msg.role || msg.author;
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.parts?.map((p: any) => p.text).filter(Boolean).join(" ");
      if (text) {
        summaryParts.push(`${role}: ${text.slice(0, 300)}`);
        count++;
      }
    }

    if (summaryParts.length === 0) return false;

    const event: RawEvent = {
      source: "gemini",
      timestamp: new Date(session.mtime).toISOString(),
      kind: "session",
      data: {
        title: "Gemini session",
        summary: summaryParts.join("\n").slice(0, 2000),
        imported: true,
      },
    };

    await storage.appendStagingEvent(session.date, event, baseDir);
    return true;
  } catch {
    return false;
  }
}

// ── Session Summary Extraction ──

export async function extractSessionSummary(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const summaryParts: string[] = [];
    let count = 0;

    for (const line of lines) {
      if (count >= 20) break;
      try {
        const msg = JSON.parse(line);

        if (msg.type === "user" && msg.message?.content != null) {
          const text = extractTextFromContent(msg.message.content);
          if (text) { summaryParts.push(`User: ${text.slice(0, 500)}`); count++; }
          continue;
        }
        if (msg.type === "assistant" && msg.message?.content != null) {
          const text = extractTextFromContent(msg.message.content);
          if (text) { summaryParts.push(`Assistant: ${text.slice(0, 500)}`); count++; }
          continue;
        }
        if (msg.type === "event_msg" && msg.payload?.type === "user_message") {
          const text = typeof msg.payload.message === "string" ? msg.payload.message : null;
          if (text) { summaryParts.push(`User: ${text.slice(0, 500)}`); count++; }
          continue;
        }
        if (msg.type === "response_item" && msg.payload?.role === "assistant") {
          const text = extractTextFromContent(msg.payload.content);
          if (text) { summaryParts.push(`Assistant: ${text.slice(0, 500)}`); count++; }
          continue;
        }
        if (msg.role === "user" && typeof msg.content === "string") {
          summaryParts.push(`User: ${msg.content.slice(0, 500)}`); count++;
        } else if (msg.role === "assistant") {
          const text = extractTextFromContent(msg.content);
          if (text) { summaryParts.push(`Assistant: ${text.slice(0, 500)}`); count++; }
        }
      } catch { continue; }
    }

    return summaryParts.length > 0 ? summaryParts.join("\n") : "Empty or unreadable session.";
  } catch {
    return "Could not read session file.";
  }
}

export function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block && "text" in block) {
        if (block.type === "text" || block.type === "input_text" || block.type === "output_text") {
          return block.text as string;
        }
      }
    }
  }
  return null;
}

// ── Helpers ──

async function walkDir(dir: string, cb: (filePath: string, stat: import("fs").Stats) => void): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, cb);
    } else {
      const stat = await fs.stat(full);
      cb(full, stat);
    }
  }
}
