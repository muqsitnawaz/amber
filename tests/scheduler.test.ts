import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startScheduler, stopScheduler, triggerManualSummarize } from "../electron/summarizer/scheduler";
import { AmberConfig } from "../electron/types";

vi.mock("../electron/config", () => ({
  loadOrDefault: vi.fn(),
}));

vi.mock("../electron/ipc", () => ({
  setAppState: vi.fn(),
}));

vi.mock("../electron/summarizer/agent", () => ({
  processDay: vi.fn(),
}));

import * as config from "../electron/config";
import * as ipc from "../electron/ipc";
import * as agent from "../electron/summarizer/agent";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let currentConfig: AmberConfig;

beforeEach(() => {
  currentConfig = {
    schedule: {
      ingest_minutes: 5,
      daily_hour: 18,
    },
    storage: {
      base_dir: "/tmp/amber-storage",
    },
    agent_sessions: {
      claude_code: true,
      clawdbot: false,
      codex: true,
      opencode: true,
    },
  };

  vi.mocked(config.loadOrDefault).mockReset().mockResolvedValue(currentConfig);
  vi.mocked(ipc.setAppState).mockReset();
  vi.mocked(agent.processDay).mockReset();
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
});

describe("summarizer scheduler", () => {
  it("triggers processing at configured daily hour", async () => {
    vi.useFakeTimers();
    const now = new Date(2026, 1, 14, 18, 1, 0, 0); // 2026-02-14 18:01 local
    vi.setSystemTime(now);

    startScheduler(currentConfig);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(agent.processDay).toHaveBeenCalledTimes(1);
    expect(agent.processDay).toHaveBeenCalledWith(isoDate(now), currentConfig);
  });

  it("does not trigger when outside scheduled hour", async () => {
    vi.useFakeTimers();
    const now = new Date(2026, 1, 14, 11, 0, 0, 0); // 2026-02-14 11:00 local
    vi.setSystemTime(now);

    startScheduler(currentConfig);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(agent.processDay).not.toHaveBeenCalled();
  });

  it("manually triggers summarization and marks last summarized date", async () => {
    vi.useFakeTimers();
    const now = new Date(2026, 1, 14, 9, 0, 0, 0);
    vi.setSystemTime(now);
    const today = isoDate(now);

    await triggerManualSummarize();

    expect(agent.processDay).toHaveBeenCalledTimes(1);
    expect(agent.processDay).toHaveBeenCalledWith(today, currentConfig);
    expect(ipc.setAppState).toHaveBeenCalledWith({ lastSummarized: today });
  });
});
