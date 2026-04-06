/**
 * End-to-end pipeline tests
 *
 * These tests verify the REAL workflow:
 * 1. Scan actual session files from ~/.claude, ~/.codex
 * 2. Extract entities using pattern matching
 * 3. Create wiki pages from extracted data
 * 4. Verify pages are readable and contain expected content
 *
 * NO MOCKING - uses real file system and real data
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { extractEntities, extractFromSessions } from "../electron/extractor";
import { runPipeline, isFirstLaunch, getSourcesSummary } from "../electron/pipeline";
import { listWikiPages, getWikiPage } from "../electron/wiki";

// Use a temp directory for test wiki storage
const TEST_BASE_DIR = path.join(os.tmpdir(), `openwiki-test-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

describe("Entity Extraction", () => {
  it("extracts tech topics from session text", () => {
    const text = `
      User: I'm working on a React app with TypeScript. Need help with the API.
      Assistant: I can help you set up a REST API using Express and connect it to PostgreSQL.
    `;

    const result = extractEntities(text, "session-1", "2025-01-01");

    expect(result.entities.length).toBeGreaterThan(0);

    const topicNames = result.entities
      .filter(e => e.type === "topic")
      .map(e => e.name.toLowerCase());

    expect(topicNames).toContain("react");
    expect(topicNames).toContain("typescript");
    expect(topicNames).toContain("api");
  });

  it("extracts project names from paths", () => {
    const text = `
      Working in /Users/john/projects/my-awesome-app
      Let's check the repo github.com/acme/super-project
    `;

    const result = extractEntities(text, "session-2", "2025-01-02");

    const projectNames = result.entities
      .filter(e => e.type === "project")
      .map(e => e.name.toLowerCase());

    expect(projectNames.some(n => n.includes("awesome") || n.includes("app"))).toBe(true);
  });

  it("extracts people from mentions", () => {
    const text = `
      I discussed this with John Smith yesterday.
      Ask @jane about the deployment.
      Email from alice@company.com regarding the bug.
    `;

    const result = extractEntities(text, "session-3", "2025-01-03");

    const personNames = result.entities
      .filter(e => e.type === "person")
      .map(e => e.name.toLowerCase());

    expect(personNames.length).toBeGreaterThan(0);
  });

  it("deduplicates entities across sessions", () => {
    const sessions = [
      { id: "s1", timestamp: "2025-01-01", summary: "Working with React and TypeScript" },
      { id: "s2", timestamp: "2025-01-02", summary: "More React development today" },
      { id: "s3", timestamp: "2025-01-03", summary: "TypeScript type definitions" },
    ];

    const entityMap = extractFromSessions(sessions);

    // React should appear once with multiple mentions
    const reactEntry = entityMap.get("topic:react");
    expect(reactEntry).toBeDefined();
    expect(reactEntry!.mentions.length).toBe(2); // appears in s1 and s2

    // TypeScript should also be deduplicated
    const tsEntry = entityMap.get("topic:typescript");
    expect(tsEntry).toBeDefined();
    expect(tsEntry!.mentions.length).toBe(2); // appears in s1 and s3
  });
});

describe("Sources Detection", () => {
  it("detects available agent sources", async () => {
    const summary = await getSourcesSummary(30);

    expect(summary).toHaveProperty("sources");
    expect(summary).toHaveProperty("totalSessions");
    expect(summary).toHaveProperty("hasData");
    expect(Array.isArray(summary.sources)).toBe(true);

    // Should detect claude_code or codex if user has them
    const knownAgents = ["claude_code", "codex", "gemini", "cursor", "openclaw", "opencode"];
    for (const source of summary.sources) {
      expect(knownAgents).toContain(source.id);
      expect(source).toHaveProperty("found");
      expect(source).toHaveProperty("sessionCount");
    }
  });
});

describe("Wiki Storage", () => {
  it("starts with empty wiki (first launch)", async () => {
    const firstLaunch = await isFirstLaunch(TEST_BASE_DIR);
    expect(firstLaunch).toBe(true);

    const pages = await listWikiPages(undefined, TEST_BASE_DIR);
    expect(pages).toEqual([]);
  });
});

describe("Full Pipeline", () => {
  it("runs the full pipeline and creates wiki pages", async () => {
    // This test runs the REAL pipeline against actual session data
    // It will only create pages if the user has agent sessions

    const summary = await getSourcesSummary(7); // Last 7 days

    if (!summary.hasData) {
      console.log("Skipping full pipeline test - no session data available");
      return;
    }

    // Run pipeline
    const result = await runPipeline({
      cutoffDays: 7,
      baseDir: TEST_BASE_DIR,
    });

    expect(result).toHaveProperty("sessionsScanned");
    expect(result).toHaveProperty("entitiesExtracted");
    expect(result).toHaveProperty("pagesCreated");
    expect(result).toHaveProperty("errors");

    console.log(`Pipeline result: ${result.sessionsScanned} sessions, ${result.entitiesExtracted} entities, ${result.pagesCreated} pages`);

    // If we extracted entities, we should have created pages
    if (result.entitiesExtracted > 0) {
      expect(result.pagesCreated + result.pagesUpdated).toBeGreaterThan(0);

      // Verify pages are readable
      const pages = await listWikiPages(undefined, TEST_BASE_DIR);
      expect(pages.length).toBeGreaterThan(0);

      // Each page should have required fields
      for (const page of pages) {
        expect(page.id).toBeTruthy();
        expect(page.title).toBeTruthy();
        expect(["project", "person", "topic"]).toContain(page.type);
        expect(page.content).toBeTruthy();
        expect(page.content).toContain("# " + page.title); // Has heading
        expect(Array.isArray(page.sources)).toBe(true);
      }

      // Test retrieval by ID
      const firstPage = pages[0];
      const retrieved = await getWikiPage(firstPage.id, TEST_BASE_DIR);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(firstPage.id);
      expect(retrieved!.content).toBe(firstPage.content);
    }
  }, 60000); // 60 second timeout for real file scanning

  it("is idempotent - running twice doesn't duplicate pages", async () => {
    const summary = await getSourcesSummary(7);

    if (!summary.hasData) {
      console.log("Skipping idempotency test - no session data available");
      return;
    }

    // Run pipeline twice
    const result1 = await runPipeline({ cutoffDays: 7, baseDir: TEST_BASE_DIR });
    const pagesAfterFirst = await listWikiPages(undefined, TEST_BASE_DIR);

    const result2 = await runPipeline({ cutoffDays: 7, baseDir: TEST_BASE_DIR });
    const pagesAfterSecond = await listWikiPages(undefined, TEST_BASE_DIR);

    // Second run should update, not create new pages
    expect(pagesAfterSecond.length).toBe(pagesAfterFirst.length);
    expect(result2.pagesCreated).toBe(0);
    expect(result2.pagesUpdated).toBeGreaterThanOrEqual(0);
  }, 120000);
});

describe("Wiki Content Quality", () => {
  it("creates pages with structured content", async () => {
    // Create a test page directly to verify structure
    const { createWikiPage, upsertWikiPage } = await import("../electron/wiki");

    const testPage = createWikiPage(
      "Test Project",
      "project",
      "# Test Project\n\nA test project for validation.\n\n## Key Facts\n- Built with TypeScript\n\n## Related\n- [[React]]\n- [[API]]",
      ["session-1"],
      ["React", "API"]
    );

    await upsertWikiPage(testPage, TEST_BASE_DIR);

    const retrieved = await getWikiPage("test-project", TEST_BASE_DIR);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Test Project");
    expect(retrieved!.type).toBe("project");
    expect(retrieved!.content).toContain("# Test Project");
    expect(retrieved!.related).toContain("React");
    expect(retrieved!.related).toContain("API");
  });
});
