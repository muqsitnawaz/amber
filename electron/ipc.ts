import { ipcMain } from "electron";
import { execSync } from "child_process";
import * as config from "./config";
import * as storage from "./storage";
import { triggerManualSummarize, processDate } from "./summarizer/scheduler";
import { detectSources } from "./sources";
import { readChromeHistory, readSafariHistory } from "./browser-history";
import { readObsidianNotes } from "./obsidian";
import { ContextEntry, PinRecord, EntityType, KnowledgeEntity } from "./types";
import { validateDate, validateConfig } from "./validate";
import { scanAgentSources, runImport, listAgentSessionPreviews, type AgentSource, type ImportProgress, type SessionPreview } from "./import";
import { backfillFromDailyNotes } from "./knowledge";

let appState = {
  bufferedEvents: 0,
  lastSummarized: null as string | null,
};

export function getAppState() {
  return appState;
}

export function setAppState(partial: Partial<typeof appState>) {
  appState = { ...appState, ...partial };
}

export function registerIpcHandlers() {
  ipcMain.handle("get-config", async () => {
    const cfg = await config.loadOrDefault();
    // Redact sensitive fields before sending to renderer
    const redacted = { ...cfg };
    if (redacted.notion?.api_key) {
      redacted.notion = { ...redacted.notion, api_key: "***" };
    }
    return redacted;
  });

  ipcMain.handle("update-config", async (_event, cfg) => {
    validateConfig(cfg);
    await config.save(cfg);
  });

  ipcMain.handle("get-daily-note", async (_event, date: string) => {
    validateDate(date);
    const cfg = await config.loadOrDefault();
    return storage.readDailyNote(date, cfg.storage.base_dir);
  });

  ipcMain.handle("get-status", async () => {
    return {
      buffered_events: appState.bufferedEvents,
      last_summarized: appState.lastSummarized,
    };
  });

  ipcMain.handle("trigger-summarize", async () => {
    await triggerManualSummarize();
  });

  // Context entries for a date — reads staging JSONL + optional browser history
  ipcMain.handle("get-entries", async (_event, date: string): Promise<ContextEntry[]> => {
    validateDate(date);
    const cfg = await config.loadOrDefault();
    const entries: ContextEntry[] = [];

    // Read staging events (git commits, agent sessions)
    const rawEvents = await storage.readStagingEvents(date, cfg.storage.base_dir);
    for (let i = 0; i < rawEvents.length; i++) {
      try {
        const event = JSON.parse(rawEvents[i]);
        entries.push({
          id: `staging-${date}-${i}`,
          source: event.source || "unknown",
          timestamp: event.timestamp || date,
          kind: event.kind || "commit",
          title: formatEventTitle(event),
          detail: formatEventDetail(event),
          projectPath: event.data?.repo_path as string | undefined,
          data: event.data || {},
        });
      } catch {
        continue;
      }
    }

    // Read browser history for that date (if enabled and date is today/yesterday)
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (date === today || date === yesterday) {
      const hoursBack = date === today ? 24 : 48;
      const browserCfg = cfg.browser_history ?? {};

      if (browserCfg.chrome) {
        const chromeEntries = await readChromeHistory(30, hoursBack);
        const dateEntries = chromeEntries.filter(
          (e) => e.timestamp.slice(0, 10) === date,
        );
        entries.push(...dateEntries);
      }

      if (browserCfg.safari) {
        const safariEntries = await readSafariHistory(30, hoursBack);
        const dateEntries = safariEntries.filter(
          (e) => e.timestamp.slice(0, 10) === date,
        );
        entries.push(...dateEntries);
      }
    }

    // Read Obsidian notes if enabled
    const obsidianCfg = cfg.obsidian ?? {};
    if (obsidianCfg.enabled && obsidianCfg.vault_paths) {
      const hoursBack = date === today ? 24 : 48;
      for (const vaultPath of obsidianCfg.vault_paths) {
        const notes = await readObsidianNotes(vaultPath, hoursBack, 20);
        const dateNotes = notes.filter(
          (e) => e.timestamp.slice(0, 10) === date,
        );
        entries.push(...dateNotes);
      }
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Annotate pinned entries
    const pins = await storage.readPinsForDate(date, cfg.storage.base_dir);
    if (pins.length > 0) {
      for (const entry of entries) {
        const fingerprint = `${entry.source}-${entry.timestamp}-${entry.kind}`;
        const match = pins.find(p => `${p.source}-${p.data?.timestamp || p.timestamp}-${p.kind}` === fingerprint
          || (p.source === entry.source && p.title === entry.title && p.kind === entry.kind));
        if (match) {
          entry.pinned = true;
          entry.pinId = match.id;
        }
      }
    }

    return entries;
  });

  // Get dates that have entries
  ipcMain.handle("get-entry-dates", async (): Promise<string[]> => {
    const cfg = await config.loadOrDefault();
    const stagingDates = await storage.listStagingDates(cfg.storage.base_dir);
    const dailyDates = await storage.listDailyNotes(cfg.storage.base_dir);
    const all = new Set([...stagingDates, ...dailyDates]);
    return Array.from(all).sort().reverse();
  });

  // Get entry counts per date (for heatmap calendar)
  ipcMain.handle("get-entry-counts", async (): Promise<Record<string, number>> => {
    const cfg = await config.loadOrDefault();
    const stagingDates = await storage.listStagingDates(cfg.storage.base_dir);
    const counts: Record<string, number> = {};
    for (const date of stagingDates) {
      const lines = await storage.readStagingEvents(date, cfg.storage.base_dir);
      counts[date] = lines.length;
    }
    return counts;
  });

  // Detect available sources
  ipcMain.handle("get-sources", async () => {
    const cfg = await config.loadOrDefault();
    return detectSources(cfg);
  });

  // Search across all staging dates
  ipcMain.handle("search-entries", async (_event, query: string, limit?: number): Promise<{ date: string; entry: ContextEntry }[]> => {
    if (!query || query.length < 2) return [];
    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 200);
    const cfg = await config.loadOrDefault();
    const allDates = await storage.listStagingDates(cfg.storage.base_dir);
    const results: { date: string; entry: ContextEntry }[] = [];
    const q = query.toLowerCase();

    for (const date of allDates.sort().reverse()) {
      if (results.length >= safeLimit) break;
      const rawEvents = await storage.readStagingEvents(date, cfg.storage.base_dir);
      for (let i = 0; i < rawEvents.length; i++) {
        if (results.length >= safeLimit) break;
        if (rawEvents[i].toLowerCase().includes(q)) {
          try {
            const event = JSON.parse(rawEvents[i]);
            results.push({
              date,
              entry: {
                id: `staging-${date}-${i}`,
                source: event.source || "unknown",
                timestamp: event.timestamp || date,
                kind: event.kind || "commit",
                title: formatEventTitle(event),
                detail: formatEventDetail(event),
                projectPath: event.data?.repo_path as string | undefined,
                data: event.data || {},
              },
            });
          } catch {
            continue;
          }
        }
      }
    }
    return results;
  });

  // Add manual memory entry
  ipcMain.handle("add-manual-entry", async (_event, title: string, detail?: string): Promise<void> => {
    if (!title || title.trim().length === 0) throw new Error("Title is required");
    if (title.length > 500) throw new Error("Title too long (max 500 chars)");
    if (detail && detail.length > 10000) throw new Error("Detail too long (max 10000 chars)");

    const cfg = await config.loadOrDefault();
    const today = new Date().toISOString().slice(0, 10);
    await storage.appendStagingEvent(today, {
      source: "user",
      timestamp: new Date().toISOString(),
      kind: "memory",
      data: {
        title: title.trim(),
        detail: detail?.trim() || undefined,
      },
    }, cfg.storage.base_dir);
  });

  // Scan agent directories for importable sessions
  ipcMain.handle("scan-import-sources", async (_event, cutoffDays?: number): Promise<AgentSource[]> => {
    return scanAgentSources(cutoffDays);
  });

  // List session previews for an agent
  ipcMain.handle("list-agent-sessions", async (_event, agentId: string, cutoffDays?: number): Promise<SessionPreview[]> => {
    return listAgentSessionPreviews(agentId, cutoffDays);
  });

  // Get count of running MCP server processes
  ipcMain.handle("get-mcp-connections", async (): Promise<number> => {
    return getMcpConnectionCount();
  });

  // Pin an entry
  ipcMain.handle("pin-entry", async (_event, entry: ContextEntry, note?: string): Promise<PinRecord> => {
    const cfg = await config.loadOrDefault();
    const pin: PinRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: entry.source,
      kind: entry.kind as PinRecord["kind"],
      date: entry.timestamp.slice(0, 10),
      title: entry.title,
      detail: entry.detail,
      projectPath: entry.projectPath,
      data: entry.data,
      note,
    };
    await storage.appendPin(pin, cfg.storage.base_dir);
    return pin;
  });

  // Unpin an entry
  ipcMain.handle("unpin-entry", async (_event, pinId: string): Promise<void> => {
    const cfg = await config.loadOrDefault();
    await storage.removePin(pinId, cfg.storage.base_dir);
  });

  // Get pins with optional date/month filter
  ipcMain.handle("get-pins", async (_event, opts?: { date?: string; month?: string }): Promise<PinRecord[]> => {
    const cfg = await config.loadOrDefault();
    const all = await storage.readAllPins(cfg.storage.base_dir);
    if (opts?.date) return all.filter(p => p.date === opts.date);
    if (opts?.month) return all.filter(p => p.date.startsWith(opts.month));
    return all;
  });

  // ── Knowledge Base ──

  ipcMain.handle("get-knowledge", async (_event, opts?: { type?: EntityType }): Promise<KnowledgeEntity[]> => {
    const cfg = await config.loadOrDefault();
    if (opts?.type) {
      return storage.readEntitiesByType(opts.type, cfg.storage.base_dir);
    }
    return storage.readAllEntities(cfg.storage.base_dir);
  });

  ipcMain.handle("get-knowledge-stats", async (): Promise<{ projects: number; people: number; topics: number }> => {
    const cfg = await config.loadOrDefault();
    const all = await storage.readAllEntities(cfg.storage.base_dir);
    return {
      projects: all.filter(e => e.type === "project").length,
      people: all.filter(e => e.type === "person").length,
      topics: all.filter(e => e.type === "topic").length,
    };
  });

  ipcMain.handle("search-knowledge", async (_event, query: string): Promise<KnowledgeEntity[]> => {
    if (!query || query.length < 1) return [];
    const cfg = await config.loadOrDefault();
    const all = await storage.readAllEntities(cfg.storage.base_dir);
    const q = query.toLowerCase();
    return all.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.slug.includes(q) ||
      JSON.stringify(e.metadata).toLowerCase().includes(q),
    );
  });

  ipcMain.handle("remove-knowledge-entity", async (_event, id: string): Promise<void> => {
    const cfg = await config.loadOrDefault();
    await storage.removeEntity(id, cfg.storage.base_dir);
  });

  ipcMain.handle("backfill-knowledge", async (): Promise<{ processed: number; entities: number }> => {
    const cfg = await config.loadOrDefault();
    return backfillFromDailyNotes(cfg.storage.base_dir);
  });

  // Process a batch of dates (after import)
  ipcMain.handle("process-dates", async (event, dates: string[]) => {
    if (!Array.isArray(dates) || dates.length === 0) return { processed: 0, failed: [] };
    const batch = dates.slice(0, 14);
    const failed: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const date = batch[i];
      event.sender.send("processing-progress", {
        current: date,
        index: i,
        total: batch.length,
        status: "processing",
      });
      try {
        await processDate(date);
      } catch (err) {
        failed.push(date);
        console.error(`Processing failed for ${date}:`, err);
      }
      event.sender.send("processing-progress", {
        current: date,
        index: i + 1,
        total: batch.length,
        status: i + 1 === batch.length ? "done" : "processing",
      });
    }
    return { processed: batch.length - failed.length, failed };
  });

  // Run import for a specific agent + time range
  ipcMain.handle("run-import", async (_event, agentId: string, cutoffDays: number): Promise<ImportProgress> => {
    const ALLOWED_CUTOFFS = [1, 7, 30, 90];
    if (!ALLOWED_CUTOFFS.includes(cutoffDays)) {
      throw new Error(`Invalid cutoff. Allowed: ${ALLOWED_CUTOFFS.join(", ")}`);
    }
    const cfg = await config.loadOrDefault();
    return runImport({ agentId, cutoffDays }, cfg.storage.base_dir);
  });
}

function formatEventTitle(event: { source?: string; kind?: string; data?: Record<string, unknown> }): string {
  const data = event.data || {};
  if (event.source === "git") {
    return `${data.repo}: ${data.subject}`;
  }
  if (event.source === "claude_code" || event.source === "clawdbot" ||
      event.source === "codex" || event.source === "opencode") {
    return data.title as string || "Agent session";
  }
  if (event.source === "obsidian") {
    return data.title as string || "Obsidian note";
  }
  if (event.source === "feedback") {
    return `Feedback: ${data.feedback_type} — ${data.message}`;
  }
  return data.title as string || `${event.source} event`;
}

function formatEventDetail(event: { source?: string; data?: Record<string, unknown> }): string | undefined {
  const data = event.data || {};
  if (event.source === "git") {
    return `${data.author} — ${(data.hash as string)?.slice(0, 8)}`;
  }
  if (event.source === "claude_code" || event.source === "clawdbot" ||
      event.source === "codex" || event.source === "opencode") {
    const summary = data.summary as string | undefined;
    if (summary) return extractFirstUserMessage(summary);
  }
  if (data.detail) {
    return data.detail as string;
  }
  return undefined;
}

function extractFirstUserMessage(summary: string): string {
  // Summary is "User: ...\nAssistant: ...\n..." — extract just the first user message
  const match = summary.match(/^User:\s*(.+?)(?:\nAssistant:|$)/s);
  const msg = match ? match[1].trim() : summary;
  return msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
}

function getMcpConnectionCount(): number {
  try {
    // Count running amber mcp-server processes (each MCP client spawns one)
    const output = execSync(
      "ps aux | grep '[m]cp-server' | grep amber | wc -l",
      { encoding: "utf-8", timeout: 3000 },
    );
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}
