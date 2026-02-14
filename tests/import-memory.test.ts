import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { runImport } from "../electron/import";
import * as storage from "../electron/storage";

let homeDir: string;
let dataDir: string;
let originalHome: string;

async function setSessionFile(
  filePath: string,
  payload: unknown[],
  timestamp: Date,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = payload.map((line) => JSON.stringify(line)).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf-8");
  await fs.utimes(filePath, timestamp, timestamp);
}

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-home-"));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-data-"));
  originalHome = process.env.HOME!;
  process.env.HOME = homeDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("runImport", () => {
  it("imports only sessions inside cutoff and writes to staging events", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const stale = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentSession = path.join(homeDir, ".codex", "sessions", "2026", "02", "14", "recent.jsonl");
    const staleSession = path.join(homeDir, ".codex", "sessions", "2026", "02", "07", "stale.jsonl");

    await setSessionFile(recentSession, [
      {
        type: "event_msg",
        payload: { type: "user_message", cwd: "/Users/engineer/projects/amber", message: "Need to compact this memory import flow" },
      },
      { type: "response_item", payload: { role: "assistant", content: "Sure, done." } },
    ], recent);

    await setSessionFile(staleSession, [
      { type: "event_msg", payload: { type: "user_message", cwd: "/Users/engineer/projects/old", message: "Old session" } },
    ], stale);

    const progress = await runImport({ agentId: "codex", cutoffDays: 2 }, dataDir);

    expect(progress.total).toBe(1);
    expect(progress.processed).toBe(1);
    expect(progress.imported).toBe(1);

    const targetDate = recent.toISOString().slice(0, 10);
    const events = await storage.readStagingEvents(targetDate, dataDir);
    expect(events).toHaveLength(1);

    const event = JSON.parse(events[0]);
    expect(event.source).toBe("codex");
    expect(event.kind).toBe("session");
    expect(event.data.imported).toBe(true);
    expect(event.data.title).toBe("Codex session: amber");
    expect(event.data.summary).toContain("User: Need to compact this memory import flow");
  });

  it("calls progress callback for each processed session", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    const sessionPath = path.join(homeDir, ".codex", "sessions", "recent.jsonl");
    await setSessionFile(sessionPath, [
      { type: "event_msg", payload: { type: "user_message", message: "Progress test" } },
    ], recent);

    const onProgress = vi.fn();
    const progress = await runImport({ agentId: "codex", cutoffDays: 2 }, dataDir, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        processed: progress.processed,
        imported: progress.imported,
        total: progress.total,
        dates: [expect.any(String)],
      }),
    );
    expect(progress.total).toBe(1);
  });

  it("rejects unknown agents", async () => {
    await expect(
      runImport({ agentId: "unknown-agent", cutoffDays: 7 } as any, dataDir),
    ).rejects.toThrow("Unknown agent");
  });
});
