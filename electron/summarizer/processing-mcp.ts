#!/usr/bin/env node
/**
 * Amber Processing MCP Server
 *
 * Standalone stdio MCP server exposing the 3 processing tools used by
 * the daily-processing agent (claude -p). Reads AMBER_BASE_DIR from env.
 *
 * Tools: write_daily_note, upsert_knowledge, read_knowledge
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as storage from "../storage";
import { upsertFromAgentCall } from "../knowledge";
import { EntityType } from "../types";

const baseDir = process.env.AMBER_BASE_DIR;
if (!baseDir) {
  process.stderr.write("processing-mcp: AMBER_BASE_DIR env var is required\n");
  process.exit(1);
}

const server = new Server(
  { name: "amber-processing", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ── List Tools ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "write_daily_note",
      description:
        "Write the final daily note for a date. Content should be markdown with YAML frontmatter including date, projects, topics, and people fields.",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format",
          },
          content: {
            type: "string",
            description: "Full markdown content including YAML frontmatter",
          },
        },
        required: ["date", "content"],
      },
    },
    {
      name: "upsert_knowledge",
      description:
        "Add or update a knowledge entity (project, person, or topic). Handles slug generation and merge logic automatically. Call this for each distinct entity you find in the events.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["project", "person", "topic"],
            description: "Entity type",
          },
          name: {
            type: "string",
            description:
              "Entity name — use consistent naming with existing entities",
          },
          source: {
            type: "string",
            description:
              "Where this was found: git, session, browser, daily_note",
          },
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format",
          },
          metadata: {
            type: "object",
            description:
              "Additional data: paths, aliases, associated_projects, repo_names, branches, keywords",
          },
        },
        required: ["type", "name", "source", "date"],
      },
    },
    {
      name: "read_knowledge",
      description:
        "Read known projects, people, and topics from the knowledge base. Use this first for naming consistency — reuse existing names rather than inventing variations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["project", "person", "topic"],
            description:
              "Filter by entity type. Omit to get all.",
          },
        },
      },
    },
  ],
}));

// ── Handle Tool Calls ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "write_daily_note": {
      const date = args?.date as string;
      const content = args?.content as string;
      if (!date || !content) {
        return {
          content: [{ type: "text", text: "Error: 'date' and 'content' are required." }],
          isError: true,
        };
      }
      await storage.writeDailyNote(date, content, baseDir);
      return {
        content: [{ type: "text", text: `Daily note written for ${date}` }],
      };
    }

    case "upsert_knowledge": {
      const type = args?.type as EntityType;
      const entityName = args?.name as string;
      const source = args?.source as string;
      const date = args?.date as string;
      const metadata = (args?.metadata as Record<string, unknown>) ?? {};
      if (!type || !entityName || !source || !date) {
        return {
          content: [{ type: "text", text: "Error: 'type', 'name', 'source', and 'date' are required." }],
          isError: true,
        };
      }
      await upsertFromAgentCall({ type, name: entityName, source, date, metadata }, baseDir);
      return {
        content: [{ type: "text", text: `Upserted ${type}: ${entityName}` }],
      };
    }

    case "read_knowledge": {
      const filterType = args?.type as EntityType | undefined;
      let entities = await storage.readAllEntities(baseDir);
      if (filterType) entities = entities.filter(e => e.type === filterType);
      if (entities.length === 0) {
        return {
          content: [{ type: "text", text: "No knowledge entities found." }],
        };
      }
      const lines = entities.map(e => {
        let line = `[${e.type}] ${e.name} (seen ${e.mention_count}x, last: ${e.last_seen})`;
        if (e.type === "project" && Array.isArray(e.metadata.paths) && e.metadata.paths.length > 0) {
          line += `\n  path: ${(e.metadata.paths as string[])[0]}`;
        }
        return line;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ── Start ──

async function main() {
  await storage.ensureDirs(baseDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`processing-mcp: ${err}\n`);
  process.exit(1);
});
