/**
 * End-to-end pipeline test
 *
 * Verifies the FULL workflow with real session data:
 * 1. Detect agent sources
 * 2. Run pipeline to extract entities
 * 3. Create wiki pages
 * 4. Verify pages are readable
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runPipeline, getSourcesSummary } from "../electron/pipeline";
import { listWikiPages, getWikiPage } from "../electron/wiki";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

const TEST_DIR = path.join(os.tmpdir(), `openwiki-e2e-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("E2E Pipeline", () => {
  it("detects available agent sources", async () => {
    const sources = await getSourcesSummary(30);

    console.log(`\nSource detection results:`);
    console.log(`  Total sessions: ${sources.totalSessions}`);
    for (const s of sources.sources) {
      if (s.found) {
        console.log(`  - ${s.name}: ${s.sessionCount} sessions`);
      }
    }

    expect(sources).toHaveProperty("sources");
    expect(sources).toHaveProperty("totalSessions");
    expect(sources).toHaveProperty("hasData");
    expect(Array.isArray(sources.sources)).toBe(true);
  });

  it("runs full pipeline and creates wiki pages", async () => {
    const sources = await getSourcesSummary(7);

    if (!sources.hasData) {
      console.log("\nSkipping: no session data in last 7 days");
      return;
    }

    // Run pipeline with progress logging
    console.log("\nRunning pipeline...");
    const result = await runPipeline({
      cutoffDays: 7,
      baseDir: TEST_DIR,
      onProgress: (p) => {
        if (p.stage === "done" || p.stage === "error") {
          console.log(`  [${p.stage}] ${p.message}`);
        }
      },
    });

    console.log(`\nPipeline results:`);
    console.log(`  Sessions scanned: ${result.sessionsScanned}`);
    console.log(`  Entities extracted: ${result.entitiesExtracted}`);
    console.log(`  Pages created: ${result.pagesCreated}`);
    console.log(`  Pages updated: ${result.pagesUpdated}`);
    console.log(`  Errors: ${result.errors.length}`);

    expect(result.sessionsScanned).toBeGreaterThan(0);

    // If we scanned sessions, we should have extracted something
    if (result.sessionsScanned > 0) {
      expect(result.entitiesExtracted).toBeGreaterThan(0);
    }

    // If we extracted entities, we should have created pages
    if (result.entitiesExtracted > 0) {
      expect(result.pagesCreated).toBeGreaterThan(0);
    }
  }, 60000);

  it("created pages are readable and valid", async () => {
    const pages = await listWikiPages(undefined, TEST_DIR);

    if (pages.length === 0) {
      console.log("\nSkipping: no pages created");
      return;
    }

    console.log(`\nVerifying ${pages.length} wiki pages...`);

    // Check structure of each page
    for (const page of pages) {
      expect(page.id).toBeTruthy();
      expect(page.title).toBeTruthy();
      expect(["project", "person", "topic"]).toContain(page.type);
      expect(page.content).toBeTruthy();
      expect(Array.isArray(page.sources)).toBe(true);
      expect(Array.isArray(page.related)).toBe(true);
      expect(page.created_at).toBeTruthy();
      expect(page.updated_at).toBeTruthy();
    }

    // Test individual page retrieval
    const firstPage = pages[0];
    const retrieved = await getWikiPage(firstPage.id, TEST_DIR);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(firstPage.id);
    expect(retrieved!.title).toBe(firstPage.title);
    expect(retrieved!.content).toBe(firstPage.content);

    // Show sample pages
    console.log(`\nSample pages:`);
    const byType = {
      project: pages.filter(p => p.type === "project").slice(0, 2),
      person: pages.filter(p => p.type === "person").slice(0, 2),
      topic: pages.filter(p => p.type === "topic").slice(0, 2),
    };

    for (const [type, items] of Object.entries(byType)) {
      if (items.length > 0) {
        console.log(`  ${type}s: ${items.map(p => p.title).join(", ")}`);
      }
    }
  });

  it("pipeline is idempotent", async () => {
    const sources = await getSourcesSummary(7);
    if (!sources.hasData) {
      console.log("\nSkipping: no session data");
      return;
    }

    const pagesBefore = await listWikiPages(undefined, TEST_DIR);
    const countBefore = pagesBefore.length;

    // Run pipeline again
    const result = await runPipeline({
      cutoffDays: 7,
      baseDir: TEST_DIR,
    });

    const pagesAfter = await listWikiPages(undefined, TEST_DIR);

    console.log(`\nIdempotency check:`);
    console.log(`  Pages before: ${countBefore}`);
    console.log(`  Pages after: ${pagesAfter.length}`);
    console.log(`  New pages created: ${result.pagesCreated}`);
    console.log(`  Pages updated: ${result.pagesUpdated}`);

    // Should not create new pages on second run
    expect(result.pagesCreated).toBe(0);
    expect(pagesAfter.length).toBe(countBefore);
  }, 60000);
});
