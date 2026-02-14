import { describe, it, expect } from "vitest";
import { resolveProcessorInvocation } from "../electron/summarizer/agent";

describe("resolveProcessorInvocation", () => {
  it("builds codex invocation with placeholders", () => {
    const { command, args } = resolveProcessorInvocation({
      provider: "codex",
      model: "spark",
      prompt: "Hello",
      mcpConfig: "{}",
      codexCommand: "codex-test",
      codexArgs: ["--headless", "--model", "{model}", "--mcp", "{mcpConfig}", "{prompt}"],
    });

    expect(command).toBe("codex-test");
    expect(args).toEqual([
      "--headless",
      "--model",
      "spark",
      "--mcp",
      "{}",
      "Hello",
    ]);
  });

  it("falls back to default codex args when empty", () => {
    const { args } = resolveProcessorInvocation({
      provider: "codex",
      model: "spark",
      prompt: "Headless compact now",
      mcpConfig: "{}",
      codexCommand: "codex",
      codexArgs: [],
    });

    expect(args).toContain("--headless");
    expect(args).toContain("spark");
    expect(args).toContain("Headless compact now");
  });
});
