#!/usr/bin/env node
/**
 * Amber MCP Server
 *
 * A standalone MCP server that exposes Amber's memory system to any AI agent.
 * Agents can both READ and WRITE context/memories.
 *
 * Usage:
 *   node dist-electron/mcp-server.js
 *
 * Add to your agent's MCP config:
 *   {
 *     "mcpServers": {
 *       "amber": {
 *         "command": "node",
 *         "args": ["/path/to/amber/dist-electron/mcp-server.js"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as storage from "./storage";
import { RawEvent, PinRecord, EventKind, EntityType } from "./types";
import { validateDate, validateMemoryInput, validateFeedbackType, validateSearchQuery } from "./validate";

const execAsync = promisify(execFile);
const MQ_PATH = process.env.MQ_PATH || "mq";

async function runMq(pathPattern: string, query: string): Promise<string> {
  try {
    const { stdout } = await execAsync(MQ_PATH, [pathPattern, query], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    if (err.code === "ENOENT") return "Error: mq binary not found. Install from https://github.com/your/mq";
    return `Error: ${err.message || err}`;
  }
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const server = new Server(
  { name: "amber", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ── List Tools ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_entries",
      description:
        "Read context entries (git commits, agent sessions, notes, browsing, etc.) for a specific date. Returns raw JSONL staging events.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
        },
      },
    },
    {
      name: "read_daily_note",
      description:
        "Read the daily summary/note for a specific date. This is the AI-generated context reference for that day.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format. Defaults to today.",
          },
        },
      },
    },
    {
      name: "append_memory",
      description:
        "Add a new memory or context entry to Amber's staging. Use this to record what you're working on, important findings, or anything relevant for future context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          source: {
            type: "string",
            description:
              "Who is appending this memory (e.g. 'claude_code', 'cursor', 'codex', 'user').",
          },
          title: {
            type: "string",
            description: "Short description of the memory/event.",
          },
          detail: {
            type: "string",
            description: "Optional longer description with context.",
          },
          project_path: {
            type: "string",
            description:
              "Filesystem path of the project this relates to, if applicable.",
          },
          kind: {
            type: "string",
            description:
              "Type of entry: 'session', 'commit', 'note', 'browse', 'chat', 'memory'. Defaults to 'memory'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for categorization.",
          },
        },
        required: ["source", "title"],
      },
    },
    {
      name: "list_dates",
      description:
        "List all dates that have context entries or daily notes available.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "search_entries",
      description:
        "Search across all staging entries for a keyword or phrase. Searches titles, details, and data fields.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query string.",
          },
          limit: {
            type: "number",
            description: "Max results to return. Defaults to 20.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "pin_entry",
      description:
        "Pin an important context entry so it stands out in the UI and gets extra weight in daily summaries. Use this for key findings, decisions, or noteworthy events.",
      inputSchema: {
        type: "object" as const,
        properties: {
          source: {
            type: "string",
            description: "Source of the entry (e.g. 'git', 'claude_code', 'user').",
          },
          title: {
            type: "string",
            description: "Title of the entry to pin.",
          },
          detail: {
            type: "string",
            description: "Optional detail text.",
          },
          project_path: {
            type: "string",
            description: "Filesystem path of the related project.",
          },
          kind: {
            type: "string",
            description: "Entry kind: 'session', 'commit', 'note', 'browse', 'chat', 'memory'. Defaults to 'memory'.",
          },
          note: {
            type: "string",
            description: "Optional annotation explaining why this was pinned.",
          },
          date: {
            type: "string",
            description: "Date the entry belongs to (YYYY-MM-DD). Defaults to today.",
          },
        },
        required: ["source", "title"],
      },
    },
    {
      name: "read_pins",
      description:
        "Read pinned entries. Pinned entries are high-priority items the user or agents have marked as important.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Filter pins for a specific date (YYYY-MM-DD).",
          },
          month: {
            type: "string",
            description: "Filter pins for a specific month (YYYY-MM).",
          },
          limit: {
            type: "number",
            description: "Max pins to return. Defaults to 50.",
          },
        },
      },
    },
    {
      name: "provide_feedback",
      description:
        "Provide feedback on a context entry or daily note — e.g. mark as outdated, incorrect, or add a correction. This helps Amber improve its context over time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date the entry belongs to (YYYY-MM-DD).",
          },
          entry_id: {
            type: "string",
            description: "ID of the specific entry, if targeting one.",
          },
          feedback_type: {
            type: "string",
            description:
              "Type: 'outdated', 'incorrect', 'correction', 'useful', 'irrelevant'.",
          },
          message: {
            type: "string",
            description: "Feedback details or correction text.",
          },
        },
        required: ["feedback_type", "message"],
      },
    },
    {
      name: "read_knowledge",
      description:
        "Read known entities (projects, people, topics) from Amber's knowledge base. Returns names, activity dates, mention counts, and metadata.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description: "Filter by entity type: 'project', 'person', or 'topic'. Omit for all.",
          },
          query: {
            type: "string",
            description: "Optional search term to filter entities by name.",
          },
          limit: {
            type: "number",
            description: "Max entities to return. Defaults to 50.",
          },
        },
      },
    },
    {
      name: "browse_records",
      description:
        "Browse the structure of staging event records using mq. Returns a tree overview of JSONL event files.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format. If omitted, browses all staging files.",
          },
        },
      },
    },
    {
      name: "search_records",
      description:
        "Search staging event records for a term using mq. Searches across JSONL event files.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term.",
          },
          date_range: {
            type: "string",
            description: "Optional scope: a date (YYYY-MM-DD) or month (YYYY-MM) to limit search.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "browse_notes",
      description:
        "Browse the structure of daily notes using mq. Returns a tree overview of markdown note files.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format. If omitted, browses all daily notes.",
          },
        },
      },
    },
    {
      name: "search_notes",
      description:
        "Search daily notes for a term using mq. Searches across all markdown note files.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search term.",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

// ── Handle Tool Calls ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "read_entries": {
      const date = validateDate((args?.date as string) || todayISO());
      const events = await storage.readStagingEvents(date);
      if (events.length === 0) {
        return {
          content: [
            { type: "text", text: `No entries found for ${date}.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${events.length} entries for ${date}:\n\n${events.join("\n")}`,
          },
        ],
      };
    }

    case "read_daily_note": {
      const date = validateDate((args?.date as string) || todayISO());
      const note = await storage.readDailyNote(date);
      if (!note) {
        return {
          content: [
            {
              type: "text",
              text: `No daily note for ${date}. The note may not have been generated yet.`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: note }],
      };
    }

    case "append_memory": {
      try {
        validateMemoryInput(args ?? {});
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }

      const source = args?.source as string;
      const title = args?.title as string;

      const event: RawEvent = {
        source,
        timestamp: new Date().toISOString(),
        kind: (args?.kind as string as RawEvent["kind"]) || "memory" as any,
        data: {
          title,
          detail: args?.detail || undefined,
          project_path: args?.project_path || undefined,
          tags: args?.tags || undefined,
        },
      };

      await storage.appendStagingEvent(todayISO(), event);

      return {
        content: [
          {
            type: "text",
            text: `Memory appended for ${todayISO()}: "${title}"`,
          },
        ],
      };
    }

    case "list_dates": {
      const staging = await storage.listStagingDates();
      const daily = await storage.listDailyNotes();
      const all = [...new Set([...staging, ...daily])].sort().reverse();

      if (all.length === 0) {
        return {
          content: [
            { type: "text", text: "No dates with entries found." },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Available dates (${all.length}):\n${all.join("\n")}`,
          },
        ],
      };
    }

    case "search_entries": {
      let query: string;
      try {
        query = validateSearchQuery(args?.query as string).toLowerCase();
      } catch {
        return {
          content: [
            { type: "text", text: "Error: 'query' is required." },
          ],
          isError: true,
        };
      }
      const limit = Math.min(Math.max((args?.limit as number) || 20, 1), 100);

      const allDates = await storage.listStagingDates();
      const results: string[] = [];

      // Search most recent dates first
      for (const date of allDates.sort().reverse()) {
        if (results.length >= limit) break;
        const events = await storage.readStagingEvents(date);
        for (const event of events) {
          if (results.length >= limit) break;
          if (event.toLowerCase().includes(query)) {
            results.push(`[${date}] ${event}`);
          }
        }
      }

      if (results.length === 0) {
        return {
          content: [
            { type: "text", text: `No entries matching "${query}".` },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `${results.length} result${results.length > 1 ? "s" : ""} for "${query}":\n\n${results.join("\n")}`,
          },
        ],
      };
    }

    case "pin_entry": {
      const source = args?.source as string;
      const title = args?.title as string;
      if (!source || !title) {
        return {
          content: [{ type: "text", text: "Error: 'source' and 'title' are required." }],
          isError: true,
        };
      }
      if (title.length > 500) {
        return {
          content: [{ type: "text", text: "Error: title too long (max 500 chars)." }],
          isError: true,
        };
      }

      const date = (args?.date as string) || todayISO();
      validateDate(date);

      const pin: PinRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source,
        kind: ((args?.kind as string) || "memory") as EventKind,
        date,
        title,
        detail: args?.detail as string | undefined,
        projectPath: args?.project_path as string | undefined,
        data: {
          title,
          detail: args?.detail || undefined,
          project_path: args?.project_path || undefined,
        },
        note: args?.note as string | undefined,
      };

      await storage.appendPin(pin);

      return {
        content: [
          { type: "text", text: `Pinned for ${date}: "${title}"${pin.note ? ` (note: ${pin.note})` : ""}` },
        ],
      };
    }

    case "read_pins": {
      const all = await storage.readAllPins();
      let filtered = all;

      if (args?.date) {
        validateDate(args.date as string);
        filtered = filtered.filter(p => p.date === args!.date);
      } else if (args?.month) {
        const month = args.month as string;
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return {
            content: [{ type: "text", text: "Error: month must be YYYY-MM format." }],
            isError: true,
          };
        }
        filtered = filtered.filter(p => p.date.startsWith(month));
      }

      const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 200);
      filtered = filtered.slice(0, limit);

      if (filtered.length === 0) {
        return {
          content: [{ type: "text", text: "No pinned entries found." }],
        };
      }

      const lines = filtered.map(p => {
        let line = `[${p.date}] [${p.source}] ${p.title}`;
        if (p.note) line += ` (note: ${p.note})`;
        if (p.detail) line += `\n  ${p.detail}`;
        return line;
      });

      return {
        content: [
          { type: "text", text: `${filtered.length} pinned entr${filtered.length === 1 ? "y" : "ies"}:\n\n${lines.join("\n")}` },
        ],
      };
    }

    case "provide_feedback": {
      const feedbackType = args?.feedback_type as string;
      const message = args?.message as string;
      if (!feedbackType || !message) {
        return {
          content: [
            {
              type: "text",
              text: "Error: 'feedback_type' and 'message' are required.",
            },
          ],
          isError: true,
        };
      }
      try {
        validateFeedbackType(feedbackType);
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
      if (message.length > 5000) {
        return {
          content: [{ type: "text", text: "Error: message too long (max 5000 chars)." }],
          isError: true,
        };
      }

      const feedbackEvent: RawEvent = {
        source: "feedback",
        timestamp: new Date().toISOString(),
        kind: "memory" as any,
        data: {
          feedback_type: feedbackType,
          message,
          target_date: args?.date || undefined,
          target_entry_id: args?.entry_id || undefined,
        },
      };

      await storage.appendStagingEvent(todayISO(), feedbackEvent);

      return {
        content: [
          {
            type: "text",
            text: `Feedback recorded: [${feedbackType}] ${message}`,
          },
        ],
      };
    }

    case "read_knowledge": {
      const limit = Math.min(Math.max((args?.limit as number) || 50, 1), 200);
      const filterType = args?.type as EntityType | undefined;
      const filterQuery = args?.query as string | undefined;

      let entities = filterType
        ? await storage.readEntitiesByType(filterType)
        : await storage.readAllEntities();

      if (filterQuery) {
        const q = filterQuery.toLowerCase();
        entities = entities.filter(e =>
          e.name.toLowerCase().includes(q) ||
          e.slug.includes(q) ||
          JSON.stringify(e.metadata).toLowerCase().includes(q),
        );
      }

      const sorted = entities.sort((a, b) => b.last_seen.localeCompare(a.last_seen)).slice(0, limit);

      if (sorted.length === 0) {
        return { content: [{ type: "text", text: "No knowledge entities found." }] };
      }

      const lines = sorted.map(e => {
        let line = `[${e.type}] ${e.name} (${e.mention_count}x, last: ${e.last_seen})`;
        if (e.type === "project" && Array.isArray(e.metadata.paths) && e.metadata.paths.length > 0) {
          line += `\n  path: ${(e.metadata.paths as string[]).join(", ")}`;
        }
        if (Array.isArray(e.metadata.associated_projects) && e.metadata.associated_projects.length > 0) {
          line += `\n  projects: ${(e.metadata.associated_projects as string[]).join(", ")}`;
        }
        return line;
      });

      return {
        content: [{ type: "text", text: `${sorted.length} entit${sorted.length === 1 ? "y" : "ies"}:\n\n${lines.join("\n")}` }],
      };
    }

    case "browse_records": {
      const baseDir = storage.resolveBaseDir();
      const stagingDir = path.join(baseDir, "staging");
      const pattern = args?.date
        ? path.join(stagingDir, `${args.date}.jsonl`)
        : path.join(stagingDir, "*.jsonl");
      const result = await runMq(pattern, '.tree("full")');
      return { content: [{ type: "text", text: result || "No staging records found." }] };
    }

    case "search_records": {
      const searchQuery = args?.query as string;
      if (!searchQuery) {
        return { content: [{ type: "text", text: "Error: 'query' is required." }], isError: true };
      }
      const baseDir = storage.resolveBaseDir();
      const stagingDir = path.join(baseDir, "staging");
      let pattern: string;
      if (args?.date_range) {
        const range = args.date_range as string;
        pattern = range.length === 7
          ? path.join(stagingDir, `${range}-*.jsonl`)
          : path.join(stagingDir, `${range}.jsonl`);
      } else {
        pattern = path.join(stagingDir, "*.jsonl");
      }
      const result = await runMq(pattern, `.search("${searchQuery.replace(/"/g, '\\"')}")`);
      return { content: [{ type: "text", text: result || `No records matching "${searchQuery}".` }] };
    }

    case "browse_notes": {
      const baseDir = storage.resolveBaseDir();
      const dailyDir = path.join(baseDir, "daily");
      const pattern = args?.date
        ? path.join(dailyDir, `${args.date}.md`)
        : path.join(dailyDir, "*.md");
      const result = await runMq(pattern, '.tree("full")');
      return { content: [{ type: "text", text: result || "No daily notes found." }] };
    }

    case "search_notes": {
      const searchQuery = args?.query as string;
      if (!searchQuery) {
        return { content: [{ type: "text", text: "Error: 'query' is required." }], isError: true };
      }
      const baseDir = storage.resolveBaseDir();
      const dailyDir = path.join(baseDir, "daily");
      const result = await runMq(path.join(dailyDir, "*.md"), `.search("${searchQuery.replace(/"/g, '\\"')}")`);
      return { content: [{ type: "text", text: result || `No notes matching "${searchQuery}".` }] };
    }

    default:
      return {
        content: [
          { type: "text", text: `Unknown tool: ${name}` },
        ],
        isError: true,
      };
  }
});

// ── Start ──

async function main() {
  await storage.ensureDirs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`amber-mcp: ${err}\n`);
  process.exit(1);
});
