import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processDayMock = vi.fn();
const loadConfigMock = vi.fn();

vi.mock("../electron/summarizer/agent", () => ({
  processDay: processDayMock,
}));

vi.mock("../electron/config", () => ({
  loadOrDefault: loadConfigMock,
}));

describe("processDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({
      schedule: { ingest_minutes: 5, daily_hour: 18 },
      storage: { base_dir: "~/.amber" },
      processing: {
        provider: "codex",
        model: "spark",
        codex_command: "codex-test",
        codex_args: ["--headless", "--model", "{model}", "-p", "{prompt}"],
      },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes codex provider config to processDay", async () => {
    const { processDate } = await import("../electron/summarizer/scheduler");

    await processDate("2026-02-14");

    expect(processDayMock).toHaveBeenCalledTimes(1);
    const [, config] = processDayMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(config.processing?.provider).toBe("codex");
    expect(config.processing?.model).toBe("spark");
  });

  it("passes through config even when codex model is omitted", async () => {
    loadConfigMock.mockResolvedValue({
      schedule: { ingest_minutes: 5, daily_hour: 18 },
      storage: { base_dir: "~/.amber" },
      processing: {
        provider: "codex",
      },
    });

    const { processDate } = await import("../electron/summarizer/scheduler");
    await processDate("2026-02-14");

    const [, config] = processDayMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(config.processing?.provider).toBe("codex");
    expect(config.processing?.model).toBeUndefined();
  });
});
