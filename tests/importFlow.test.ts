import { describe, it, expect, vi } from "vitest";
import { runImportWithAutoProcess } from "../src/lib/importFlow";
import { type ImportProgress } from "../src/lib/api";

describe("runImportWithAutoProcess", () => {
  it("runs import and auto-processes returned dates", async () => {
    const result: ImportProgress = {
      agentId: "codex",
      total: 2,
      processed: 0,
      imported: 1,
      dates: ["2026-02-13", "2026-02-14"],
    };
    const runImport = vi.fn().mockResolvedValue(result);
    const processDates = vi.fn().mockResolvedValue({ processed: 2, failed: [] });
    const onAutoProcessStart = vi.fn();
    const onProgress = vi.fn();
    const offProgress = vi.fn();
    const onProgressRegistration = vi.fn();

    const deps = { runImport, processDates, onProgress: onProgressRegistration, offProgress };

    await runImportWithAutoProcess({
      agentId: "codex",
      cutoffDays: 7,
      deps,
      onProgress,
      onAutoProcessStart,
    });

    expect(runImport).toHaveBeenCalledWith("codex", 7);
    expect(onAutoProcessStart).toHaveBeenCalledWith("codex", result.dates.length);
    expect(processDates).toHaveBeenCalledWith(result.dates);
    expect(onProgressRegistration).toHaveBeenCalledWith(onProgress);
    expect(offProgress).toHaveBeenCalledTimes(1);
  });

  it("does not auto-process when no dates are returned", async () => {
    const result: ImportProgress = {
      agentId: "codex",
      total: 0,
      processed: 0,
      imported: 0,
      dates: [],
    };
    const runImport = vi.fn().mockResolvedValue(result);
    const processDates = vi.fn();
    const onProgress = vi.fn();
    const onAutoProcessStart = vi.fn();
    const onProgressEvent = vi.fn();
    const offProgress = vi.fn();

    const deps = {
      runImport,
      processDates,
      onProgress: onProgressEvent,
      offProgress,
    };

    const actual = await runImportWithAutoProcess({
      agentId: "codex",
      cutoffDays: 30,
      deps,
      onProgress,
      onAutoProcessStart,
    });

    expect(actual).toEqual(result);
    expect(processDates).not.toHaveBeenCalled();
    expect(onAutoProcessStart).not.toHaveBeenCalled();
    expect(onProgressEvent).not.toHaveBeenCalled();
    expect(offProgress).not.toHaveBeenCalled();
  });

  it("unsubscribes progress listener even if processing fails", async () => {
    const result: ImportProgress = {
      agentId: "codex",
      total: 1,
      processed: 0,
      imported: 0,
      dates: ["2026-02-14"],
    };
    const runImport = vi.fn().mockResolvedValue(result);
    const processDates = vi.fn().mockRejectedValue(new Error("processing failed"));
    const onProgress = vi.fn();
    const onAutoProcessStart = vi.fn();
    const offProgress = vi.fn();

    const deps = {
      runImport,
      processDates,
      onProgress,
      offProgress,
    };

    await expect(
      runImportWithAutoProcess({
        agentId: "codex",
        cutoffDays: 1,
        deps,
        onProgress: onProgress,
        onAutoProcessStart,
      }),
    ).rejects.toThrow("processing failed");

    expect(onAutoProcessStart).toHaveBeenCalledWith("codex", result.dates.length);
    expect(offProgress).toHaveBeenCalledTimes(1);
  });
});
