import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";

const execAsync = promisify(execFile);
const MCP_SERVER_PATH = path.resolve(__dirname, "../dist-electron/mcp-server.js");

let hasMq = false;
let originalHome: string;
let tmpHome: string;

describe("MCP Server", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    originalHome = process.env.HOME!;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "amber-mcp-home-"));
    process.env.HOME = tmpHome;

    // Check if mq is available
    try {
      await execAsync("mq", ["--help"]);
      hasMq = true;
    } catch {
      hasMq = false;
    }

    // Ensure the server is built
    try {
      await fs.access(MCP_SERVER_PATH);
    } catch {
      throw new Error(`MCP server not built. Run 'bun run build' first.`);
    }

    transport = new StdioClientTransport({
      command: "node",
      args: [MCP_SERVER_PATH],
    });

    client = new Client(
      { name: "amber-test", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
  }, 15000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // may already be closed
    }
    process.env.HOME = originalHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("should list all 13 tools", async () => {
    const res = await client.listTools();
    const toolNames = res.tools.map((t) => t.name);

    expect(toolNames).toContain("read_entries");
    expect(toolNames).toContain("read_daily_note");
    expect(toolNames).toContain("append_memory");
    expect(toolNames).toContain("list_dates");
    expect(toolNames).toContain("search_entries");
    expect(toolNames).toContain("provide_feedback");
    expect(toolNames).toContain("pin_entry");
    expect(toolNames).toContain("read_pins");
    expect(toolNames).toContain("read_knowledge");
    expect(toolNames).toContain("browse_records");
    expect(toolNames).toContain("search_records");
    expect(toolNames).toContain("browse_notes");
    expect(toolNames).toContain("search_notes");
    expect(toolNames.length).toBe(13);
  });

  it("should handle list_dates", async () => {
    const res = await client.callTool({ name: "list_dates", arguments: {} });
    expect(res.content).toBeInstanceOf(Array);
    expect((res.content as any)[0].type).toBe("text");
  });

  it("should handle read_entries for empty date", async () => {
    const res = await client.callTool({
      name: "read_entries",
      arguments: { date: "2099-01-01" },
    });
    expect((res.content as any)[0].text).toContain("No entries found");
  });

  it("should handle read_daily_note for missing date", async () => {
    const res = await client.callTool({
      name: "read_daily_note",
      arguments: { date: "2099-01-01" },
    });
    expect((res.content as any)[0].text).toContain("No daily note");
  });

  it("should append and read back a memory", async () => {
    // Append
    const appendRes = await client.callTool({
      name: "append_memory",
      arguments: {
        source: "user",
        title: "MCP test memory",
        detail: "Written via MCP server test",
        project_path: "/tmp/test-project",
        kind: "memory",
        tags: ["test", "mcp"],
      },
    });
    expect((appendRes.content as any)[0].text).toContain("Memory appended");

    // Read back — use local date to match server's todayISO()
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const readRes = await client.callTool({
      name: "read_entries",
      arguments: { date: today },
    });
    expect((readRes.content as any)[0].text).toContain("MCP test memory");
  });

  it("should search entries", async () => {
    const res = await client.callTool({
      name: "search_entries",
      arguments: { query: "MCP test memory", limit: 5 },
    });
    expect((res.content as any)[0].text).toContain("MCP test memory");
  });

  it("should reject search with no query", async () => {
    const res = await client.callTool({
      name: "search_entries",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  it("should reject append_memory missing title", async () => {
    const res = await client.callTool({
      name: "append_memory",
      arguments: { source: "vitest" },
    });
    expect(res.isError).toBe(true);
  });

  it("should provide feedback", async () => {
    const res = await client.callTool({
      name: "provide_feedback",
      arguments: {
        feedback_type: "outdated",
        message: "This entry is no longer relevant",
      },
    });
    expect((res.content as any)[0].text).toContain("Feedback recorded");
  });

  it("should handle read_knowledge", async () => {
    const res = await client.callTool({
      name: "read_knowledge",
      arguments: {},
    });
    expect(res.content).toBeInstanceOf(Array);
    expect((res.content as any)[0].type).toBe("text");
  });

  it("should handle read_knowledge with type filter", async () => {
    const res = await client.callTool({
      name: "read_knowledge",
      arguments: { type: "project" },
    });
    expect(res.content).toBeInstanceOf(Array);
    expect((res.content as any)[0].type).toBe("text");
  });

  it("should handle browse_records", async () => {
    if (!hasMq) return; // skip if mq not installed
    const res = await client.callTool({
      name: "browse_records",
      arguments: {},
    });
    expect(res.content).toBeInstanceOf(Array);
    expect((res.content as any)[0].type).toBe("text");
  });

  it("should handle search_notes", async () => {
    if (!hasMq) return; // skip if mq not installed
    const res = await client.callTool({
      name: "search_notes",
      arguments: { query: "test" },
    });
    expect(res.content).toBeInstanceOf(Array);
    expect((res.content as any)[0].type).toBe("text");
  });

  it("should reject search_notes without query", async () => {
    const res = await client.callTool({
      name: "search_notes",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  it("should return error for unknown tool", async () => {
    const res = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });
});
