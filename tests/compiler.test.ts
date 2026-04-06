import { describe, it, expect } from "vitest";
import { compileWikiPage, EntityMention } from "../electron/compiler";

describe("compileWikiPage", () => {
  it("generates markdown and extracts related links", async () => {
    const mentions: EntityMention[] = [
      {
        sessionId: "s1",
        timestamp: "2025-01-01T00:00:00Z",
        context: "Discussed Amber with Jane Doe about project milestones and delivery timeline.",
      },
      {
        sessionId: "s2",
        timestamp: "2025-01-02T00:00:00Z",
        context: "Amber integrates with Obsidian and references Project Quartz for related work.",
      },
    ];

    const result = await compileWikiPage("Amber", "project", mentions);

    expect(result.content).toMatch(/^# Amber/m);
    expect(result.content).toMatch(/##\s+Key Facts/i);
    expect(result.content).toMatch(/##\s+Related/i);

    const extracted = Array.from(
      new Set(
        Array.from(result.content.matchAll(/\[\[([^\]]+)\]\]/g))
          .map((match) => match[1].trim())
          .filter(Boolean),
      ),
    );

    expect(result.related).toEqual(extracted);
    expect(result.related.length).toBeGreaterThan(0);

    const wordCount = result.content.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(550);
  }, 120000);
});
