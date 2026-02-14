import { describe, it, expect } from "vitest";
import {
  validateDate,
  validateConfig,
  validateMemoryInput,
  validateBaseDir,
  validateFeedbackType,
  validateSearchQuery,
} from "../electron/validate";
import * as os from "os";

describe("validateDate", () => {
  it("accepts valid dates", () => {
    expect(validateDate("2025-01-15")).toBe("2025-01-15");
    expect(validateDate("2024-12-31")).toBe("2024-12-31");
    expect(validateDate("2025-06-01")).toBe("2025-06-01");
  });

  it("rejects path traversal", () => {
    expect(() => validateDate("../../etc/passwd")).toThrow("Invalid date format");
    expect(() => validateDate("../../../etc/shadow")).toThrow("Invalid date format");
  });

  it("rejects partial dates", () => {
    expect(() => validateDate("2025-01")).toThrow("Invalid date format");
    expect(() => validateDate("2025")).toThrow("Invalid date format");
    expect(() => validateDate("01-15")).toThrow("Invalid date format");
  });

  it("rejects invalid formats", () => {
    expect(() => validateDate("not-a-date")).toThrow("Invalid date format");
    expect(() => validateDate("2025/01/15")).toThrow("Invalid date format");
    expect(() => validateDate("")).toThrow("Invalid date format");
  });

  it("rejects non-existent dates", () => {
    expect(() => validateDate("2025-13-01")).toThrow();
    expect(() => validateDate("2025-00-01")).toThrow();
  });
});

describe("validateConfig", () => {
  it("accepts valid config", () => {
    expect(() =>
      validateConfig({
        schedule: { daily_hour: 18, ingest_minutes: 5 },
        storage: { base_dir: "~/.amber" },
        processing: {
          provider: "codex",
          model: "spark",
          codex_command: "codex",
          codex_args: ["--headless", "--model", "{model}"],
        },
      }),
    ).not.toThrow();
  });

  it("rejects out-of-bounds schedule", () => {
    expect(() =>
      validateConfig({ schedule: { daily_hour: 25 } }),
    ).toThrow("daily_hour must be 0-23");

    expect(() =>
      validateConfig({ schedule: { daily_hour: -1 } }),
    ).toThrow("daily_hour must be 0-23");

    expect(() =>
      validateConfig({ schedule: { ingest_minutes: 0 } }),
    ).toThrow("ingest_minutes must be 1-60");

    expect(() =>
      validateConfig({ schedule: { ingest_minutes: 100 } }),
    ).toThrow("ingest_minutes must be 1-60");
  });

  it("accepts config without summarizer", () => {
    expect(() => validateConfig({ sources: {} })).not.toThrow();
  });

  it("rejects invalid processing provider", () => {
    expect(() =>
      validateConfig({ processing: { provider: "gpt4" as any } }),
    ).toThrow(`processing.provider must be "claude" or "codex"`);
  });

  it("rejects invalid processing codex args", () => {
    expect(() =>
      validateConfig({ processing: { codex_args: ["ok", 123 as any] as any } }),
    ).toThrow("processing.codex_args must contain only strings");
  });
});

describe("validateMemoryInput", () => {
  it("accepts valid input", () => {
    expect(() =>
      validateMemoryInput({
        source: "claude_code",
        title: "Test memory",
        detail: "Some detail",
        kind: "memory",
      }),
    ).not.toThrow();
  });

  it("accepts all valid sources", () => {
    const sources = [
      "claude_code", "cursor", "codex", "opencode",
      "user", "clawdbot", "gemini", "aider", "copilot",
    ];
    for (const source of sources) {
      expect(() => validateMemoryInput({ source, title: "test" })).not.toThrow();
    }
  });

  it("rejects unknown sources", () => {
    expect(() =>
      validateMemoryInput({ source: "evil_agent", title: "test" }),
    ).toThrow("Invalid source");

    expect(() =>
      validateMemoryInput({ source: "vitest", title: "test" }),
    ).toThrow("Invalid source");
  });

  it("rejects oversized title", () => {
    expect(() =>
      validateMemoryInput({ source: "user", title: "x".repeat(501) }),
    ).toThrow("title too long");
  });

  it("rejects oversized detail", () => {
    expect(() =>
      validateMemoryInput({
        source: "user",
        title: "test",
        detail: "x".repeat(10001),
      }),
    ).toThrow("detail too long");
  });

  it("rejects invalid kind", () => {
    expect(() =>
      validateMemoryInput({ source: "user", title: "test", kind: "exploit" }),
    ).toThrow("Invalid kind");
  });

  it("requires title", () => {
    expect(() =>
      validateMemoryInput({ source: "user" }),
    ).toThrow("title is required");
  });
});

describe("validateBaseDir", () => {
  it("accepts paths under home", () => {
    const home = os.homedir();
    expect(validateBaseDir("~/.amber")).toBe(`${home}/.amber`);
    expect(validateBaseDir(`${home}/my-amber`)).toBe(`${home}/my-amber`);
  });

  it("rejects /etc", () => {
    expect(() => validateBaseDir("/etc")).toThrow("must be under home directory");
  });

  it("rejects /tmp", () => {
    expect(() => validateBaseDir("/tmp")).toThrow("must be under home directory");
  });

  it("rejects traversal", () => {
    expect(() => validateBaseDir("~/../etc")).toThrow("must be under home directory");
  });
});

describe("validateFeedbackType", () => {
  it("accepts valid types", () => {
    for (const t of ["outdated", "incorrect", "correction", "useful", "irrelevant"]) {
      expect(() => validateFeedbackType(t)).not.toThrow();
    }
  });

  it("rejects invalid types", () => {
    expect(() => validateFeedbackType("malicious")).toThrow("Invalid feedback_type");
  });
});

describe("validateSearchQuery", () => {
  it("returns valid query", () => {
    expect(validateSearchQuery("test")).toBe("test");
  });

  it("truncates long queries", () => {
    const long = "x".repeat(600);
    expect(validateSearchQuery(long).length).toBe(500);
  });

  it("rejects empty query", () => {
    expect(() => validateSearchQuery("")).toThrow("query is required");
  });
});
