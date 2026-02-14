import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  ensureDirs,
  readDailyNote,
  writeDailyNote,
  appendStagingEvent,
  readStagingEvents,
  clearStaging,
  listDailyNotes,
  resolveBaseDir,
  appendPin,
  readAllPins,
  removePin,
  readPinsForDate,
} from "../electron/storage";
import type { PinRecord } from "../electron/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveBaseDir", () => {
  it("resolves ~ to homedir", () => {
    expect(resolveBaseDir("~/.amber")).toBe(path.join(os.homedir(), ".amber"));
  });

  it("uses default when empty", () => {
    expect(resolveBaseDir()).toBe(path.join(os.homedir(), ".amber"));
  });

  it("passes through absolute paths under home", () => {
    const homePath = os.homedir() + "/custom-amber";
    expect(resolveBaseDir(homePath)).toBe(homePath);
  });
});

describe("ensureDirs", () => {
  it("creates daily and staging directories", async () => {
    await ensureDirs(tmpDir);

    const daily = await fs.stat(path.join(tmpDir, "daily"));
    const staging = await fs.stat(path.join(tmpDir, "staging"));

    expect(daily.isDirectory()).toBe(true);
    expect(staging.isDirectory()).toBe(true);
  });

  it("is idempotent", async () => {
    await ensureDirs(tmpDir);
    await ensureDirs(tmpDir);

    const daily = await fs.stat(path.join(tmpDir, "daily"));
    expect(daily.isDirectory()).toBe(true);
  });
});

describe("daily notes", () => {
  it("returns null for non-existent note", async () => {
    await ensureDirs(tmpDir);
    const note = await readDailyNote("2025-01-15", tmpDir);
    expect(note).toBeNull();
  });

  it("round-trips write and read", async () => {
    await ensureDirs(tmpDir);
    const content = "---\ndate: 2025-01-15\n---\n\n## Shipped\n- Feature X";

    await writeDailyNote("2025-01-15", content, tmpDir);
    const result = await readDailyNote("2025-01-15", tmpDir);

    expect(result).toBe(content);
  });

  it("overwrites existing note", async () => {
    await ensureDirs(tmpDir);

    await writeDailyNote("2025-01-15", "v1", tmpDir);
    await writeDailyNote("2025-01-15", "v2", tmpDir);
    const result = await readDailyNote("2025-01-15", tmpDir);

    expect(result).toBe("v2");
  });
});

describe("staging events", () => {
  it("returns empty array when no events", async () => {
    await ensureDirs(tmpDir);
    const events = await readStagingEvents("2025-01-15", tmpDir);
    expect(events).toEqual([]);
  });

  it("appends and reads events", async () => {
    await ensureDirs(tmpDir);

    const event1 = {
      source: "git",
      timestamp: "2025-01-15T10:00:00",
      kind: "commit" as const,
      data: { repo: "amber", hash: "abc123", subject: "feat: add stuff", author: "dev" },
    };

    const event2 = {
      source: "git",
      timestamp: "2025-01-15T11:00:00",
      kind: "commit" as const,
      data: { repo: "amber", hash: "def456", subject: "fix: bug", author: "dev" },
    };

    await appendStagingEvent("2025-01-15", event1, tmpDir);
    await appendStagingEvent("2025-01-15", event2, tmpDir);

    const events = await readStagingEvents("2025-01-15", tmpDir);
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0])).toMatchObject({ source: "git", data: { hash: "abc123" } });
    expect(JSON.parse(events[1])).toMatchObject({ source: "git", data: { hash: "def456" } });
  });

  it("clears staging events", async () => {
    await ensureDirs(tmpDir);

    await appendStagingEvent("2025-01-15", {
      source: "git",
      timestamp: "2025-01-15T10:00:00",
      kind: "commit",
      data: { repo: "test" },
    }, tmpDir);

    await clearStaging("2025-01-15", tmpDir);
    const events = await readStagingEvents("2025-01-15", tmpDir);
    expect(events).toEqual([]);
  });

  it("clearStaging is safe on missing files", async () => {
    await ensureDirs(tmpDir);
    await expect(clearStaging("2099-01-01", tmpDir)).resolves.toBeUndefined();
  });
});

describe("listDailyNotes", () => {
  it("returns empty array when no notes", async () => {
    await ensureDirs(tmpDir);
    const dates = await listDailyNotes(tmpDir);
    expect(dates).toEqual([]);
  });

  it("lists all note dates", async () => {
    await ensureDirs(tmpDir);

    await writeDailyNote("2025-01-13", "note 1", tmpDir);
    await writeDailyNote("2025-01-14", "note 2", tmpDir);
    await writeDailyNote("2025-01-15", "note 3", tmpDir);

    const dates = await listDailyNotes(tmpDir);
    expect(dates).toHaveLength(3);
    expect(dates).toContain("2025-01-13");
    expect(dates).toContain("2025-01-14");
    expect(dates).toContain("2025-01-15");
  });

  it("ignores non-md files", async () => {
    await ensureDirs(tmpDir);

    await writeDailyNote("2025-01-15", "note", tmpDir);
    await fs.writeFile(path.join(tmpDir, "daily", "notes.txt"), "junk");

    const dates = await listDailyNotes(tmpDir);
    expect(dates).toEqual(["2025-01-15"]);
  });
});

describe("pin storage", () => {
  const makePin = (overrides: Partial<PinRecord> = {}): PinRecord => ({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: "git",
    kind: "commit",
    date: "2025-01-15",
    title: "feat: test pin",
    data: { repo: "test" },
    ...overrides,
  });

  it("returns empty array when no pins", async () => {
    const pins = await readAllPins(tmpDir);
    expect(pins).toEqual([]);
  });

  it("appends and reads pins", async () => {
    const pin1 = makePin({ title: "pin one" });
    const pin2 = makePin({ title: "pin two" });

    await appendPin(pin1, tmpDir);
    await appendPin(pin2, tmpDir);

    const pins = await readAllPins(tmpDir);
    expect(pins).toHaveLength(2);
    expect(pins[0].title).toBe("pin one");
    expect(pins[1].title).toBe("pin two");
  });

  it("removes a pin by id", async () => {
    const pin1 = makePin({ title: "keep" });
    const pin2 = makePin({ title: "remove" });

    await appendPin(pin1, tmpDir);
    await appendPin(pin2, tmpDir);

    await removePin(pin2.id, tmpDir);

    const pins = await readAllPins(tmpDir);
    expect(pins).toHaveLength(1);
    expect(pins[0].title).toBe("keep");
  });

  it("filters pins by date", async () => {
    const pin1 = makePin({ date: "2025-01-15", title: "jan 15" });
    const pin2 = makePin({ date: "2025-01-16", title: "jan 16" });

    await appendPin(pin1, tmpDir);
    await appendPin(pin2, tmpDir);

    const filtered = await readPinsForDate("2025-01-15", tmpDir);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("jan 15");
  });
});
