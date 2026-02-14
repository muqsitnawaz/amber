import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  extractSessionSummary,
  extractTextFromContent,
} from "../electron/import";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-session-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("extractTextFromContent", () => {
  it("handles plain string content", () => {
    expect(extractTextFromContent("hello world")).toBe("hello world");
  });

  it("extracts text from content blocks array", () => {
    const content = [
      { type: "text", text: "This is the response" },
    ];
    expect(extractTextFromContent(content)).toBe("This is the response");
  });

  it("finds text block among tool_use blocks", () => {
    const content = [
      { type: "tool_use", id: "123", name: "read_file", input: {} },
      { type: "text", text: "Here is the analysis" },
    ];
    expect(extractTextFromContent(content)).toBe("Here is the analysis");
  });

  it("returns null for empty array", () => {
    expect(extractTextFromContent([])).toBeNull();
  });

  it("returns null for null", () => {
    expect(extractTextFromContent(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(extractTextFromContent(undefined)).toBeNull();
  });

  it("returns null for number", () => {
    expect(extractTextFromContent(42)).toBeNull();
  });

  it("returns null for array with no text blocks", () => {
    const content = [
      { type: "tool_use", id: "123", name: "bash", input: { command: "ls" } },
      { type: "tool_result", tool_use_id: "123", content: "file1.ts" },
    ];
    expect(extractTextFromContent(content)).toBeNull();
  });

  it("returns first text block when multiple exist", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(extractTextFromContent(content)).toBe("first");
  });
});

describe("extractSessionSummary", () => {
  it("extracts user and assistant messages from JSONL", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ role: "user", content: "Help me fix the bug" }),
      JSON.stringify({ role: "assistant", content: "I'll look into the error." }),
      JSON.stringify({ role: "user", content: "Try the tests now" }),
      JSON.stringify({ role: "assistant", content: "All tests pass!" }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    expect(result).toContain("User: Help me fix the bug");
    expect(result).toContain("Assistant: I'll look into the error.");
    expect(result).toContain("User: Try the tests now");
    expect(result).toContain("Assistant: All tests pass!");
  });

  it("handles assistant messages with content blocks array", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ role: "user", content: "What does this code do?" }),
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "tool_use", id: "abc", name: "read_file", input: { path: "main.ts" } },
          { type: "text", text: "This file handles the main entry point." },
        ],
      }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    expect(result).toContain("User: What does this code do?");
    expect(result).toContain("Assistant: This file handles the main entry point.");
  });

  it("skips malformed JSON lines gracefully", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ role: "user", content: "Hello" }),
      "this is not valid json {{{",
      JSON.stringify({ role: "assistant", content: "Hi there!" }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi there!");
  });

  it("truncates long messages to 500 chars", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const longMessage = "x".repeat(1000);
    const lines = [
      JSON.stringify({ role: "user", content: longMessage }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    // The "User: " prefix + 500 chars
    expect(result.length).toBeLessThan(600);
  });

  it("caps at 20 messages", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(JSON.stringify({ role: "user", content: `Message ${i}` }));
    }
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);
    const messageCount = (result.match(/User:/g) || []).length;

    expect(messageCount).toBe(20);
  });

  it("returns fallback for empty file", async () => {
    const sessionPath = path.join(tmpDir, "empty.jsonl");
    await fs.writeFile(sessionPath, "");

    const result = await extractSessionSummary(sessionPath);
    expect(result).toBe("Empty or unreadable session.");
  });

  it("returns fallback for missing file", async () => {
    const result = await extractSessionSummary(path.join(tmpDir, "nonexistent.jsonl"));
    expect(result).toBe("Could not read session file.");
  });

  it("skips messages without recognized roles", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ role: "system", content: "You are helpful" }),
      JSON.stringify({ role: "user", content: "Hello" }),
      JSON.stringify({ role: "tool", content: "tool result" }),
      JSON.stringify({ role: "assistant", content: "Hi!" }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    expect(result).toContain("User: Hello");
    expect(result).toContain("Assistant: Hi!");
    expect(result).not.toContain("system");
    expect(result).not.toContain("tool result");
  });

  it("handles assistant content blocks with only tool_use (no text)", async () => {
    const sessionPath = path.join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({ role: "user", content: "Run the build" }),
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "tool_use", id: "abc", name: "bash", input: { command: "npm run build" } },
        ],
      }),
    ];
    await fs.writeFile(sessionPath, lines.join("\n"));

    const result = await extractSessionSummary(sessionPath);

    expect(result).toContain("User: Run the build");
    // The assistant message has no text block, so it should be skipped
    expect(result).not.toContain("Assistant:");
  });
});
