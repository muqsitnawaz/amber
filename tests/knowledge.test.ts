import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as storage from "../electron/storage";
import { buildSlug, upsertFromAgentCall } from "../electron/knowledge";
import { KnowledgeEntity } from "../electron/types";

let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `amber-knowledge-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("buildSlug", () => {
  it("should generate project slug", () => {
    expect(buildSlug("project", "amber")).toBe("project:amber");
  });

  it("should lowercase and hyphenate", () => {
    expect(buildSlug("person", "Alice Smith")).toBe("person:alice-smith");
  });

  it("should handle multiple spaces", () => {
    expect(buildSlug("topic", "React  Hooks")).toBe("topic:react-hooks");
  });

  it("should be case-insensitive", () => {
    expect(buildSlug("project", "Amber")).toBe(buildSlug("project", "amber"));
  });
});

describe("storage: upsertEntity", () => {
  it("should create a new entity", async () => {
    const entity: KnowledgeEntity = {
      id: "test-1",
      type: "project",
      slug: "project:amber",
      name: "amber",
      first_seen: "2025-01-15",
      last_seen: "2025-01-15",
      mention_count: 1,
      sources: ["git"],
      metadata: { paths: ["/home/user/amber"], repo_names: ["amber"] },
    };

    await storage.upsertEntity(entity, testDir);
    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("amber");
  });

  it("should merge on duplicate slug", async () => {
    const first: KnowledgeEntity = {
      id: "id-1",
      type: "project",
      slug: "project:amber",
      name: "amber",
      first_seen: "2025-01-10",
      last_seen: "2025-01-10",
      mention_count: 2,
      sources: ["git"],
      metadata: { paths: ["/path/a"], repo_names: ["amber"], branches: ["main"] },
    };

    const second: KnowledgeEntity = {
      id: "id-2",
      type: "project",
      slug: "project:amber",
      name: "amber",
      first_seen: "2025-01-15",
      last_seen: "2025-01-20",
      mention_count: 3,
      sources: ["daily_note"],
      metadata: { paths: ["/path/b"], repo_names: ["amber"], branches: ["dev"] },
    };

    await storage.upsertEntity(first, testDir);
    await storage.upsertEntity(second, testDir);

    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);

    const merged = all[0];
    expect(merged.first_seen).toBe("2025-01-10");
    expect(merged.last_seen).toBe("2025-01-20");
    expect(merged.mention_count).toBe(5);
    expect(merged.sources).toContain("git");
    expect(merged.sources).toContain("daily_note");
    expect(merged.metadata.paths).toContain("/path/a");
    expect(merged.metadata.paths).toContain("/path/b");
    expect(merged.metadata.branches).toContain("main");
    expect(merged.metadata.branches).toContain("dev");
  });
});

describe("storage: removeEntity", () => {
  it("should remove entity by id", async () => {
    const entity: KnowledgeEntity = {
      id: "remove-me",
      type: "person",
      slug: "person:alice",
      name: "Alice",
      first_seen: "2025-01-15",
      last_seen: "2025-01-15",
      mention_count: 1,
      sources: ["git"],
      metadata: { aliases: [] },
    };

    await storage.upsertEntity(entity, testDir);
    expect(await storage.readAllEntities(testDir)).toHaveLength(1);

    await storage.removeEntity("remove-me", testDir);
    expect(await storage.readAllEntities(testDir)).toHaveLength(0);
  });
});

describe("storage: readEntitiesByType", () => {
  it("should filter by type", async () => {
    await storage.upsertEntity({
      id: "p1", type: "project", slug: "project:x", name: "x",
      first_seen: "2025-01-01", last_seen: "2025-01-01",
      mention_count: 1, sources: ["git"], metadata: {},
    }, testDir);

    await storage.upsertEntity({
      id: "t1", type: "topic", slug: "topic:react", name: "React",
      first_seen: "2025-01-01", last_seen: "2025-01-01",
      mention_count: 1, sources: ["daily_note"], metadata: {},
    }, testDir);

    const projects = await storage.readEntitiesByType("project", testDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("x");

    const topics = await storage.readEntitiesByType("topic", testDir);
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe("React");
  });
});

describe("upsertFromAgentCall", () => {
  it("should create entity from agent input", async () => {
    await upsertFromAgentCall({
      type: "project",
      name: "amber",
      source: "git",
      date: "2025-01-15",
      metadata: { paths: ["/Users/muqsit/amber"], repo_names: ["amber"] },
    }, testDir);

    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("amber");
    expect(all[0].type).toBe("project");
    expect(all[0].slug).toBe("project:amber");
    expect(all[0].metadata.paths).toContain("/Users/muqsit/amber");
  });

  it("should merge with existing entity on same slug", async () => {
    await upsertFromAgentCall({
      type: "person",
      name: "Alice",
      source: "git",
      date: "2025-01-10",
      metadata: { aliases: ["asmith"], associated_projects: ["project:amber"] },
    }, testDir);

    await upsertFromAgentCall({
      type: "person",
      name: "Alice",
      source: "session",
      date: "2025-01-15",
      metadata: { aliases: ["alice-s"], associated_projects: ["project:other"] },
    }, testDir);

    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);
    expect(all[0].mention_count).toBe(2);
    expect(all[0].sources).toContain("git");
    expect(all[0].sources).toContain("session");
    expect(all[0].metadata.aliases).toContain("asmith");
    expect(all[0].metadata.aliases).toContain("alice-s");
    expect(all[0].metadata.associated_projects).toContain("project:amber");
    expect(all[0].metadata.associated_projects).toContain("project:other");
  });

  it("should handle missing metadata", async () => {
    await upsertFromAgentCall({
      type: "topic",
      name: "React",
      source: "browser",
      date: "2025-01-15",
    }, testDir);

    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("React");
    expect(all[0].type).toBe("topic");
  });
});

describe("merge logic", () => {
  it("should keep earliest first_seen and latest last_seen", async () => {
    await storage.upsertEntity({
      id: "a",
      type: "project",
      slug: "project:test",
      name: "test",
      first_seen: "2025-03-01",
      last_seen: "2025-03-01",
      mention_count: 1,
      sources: ["git"],
      metadata: { paths: [], repo_names: ["test"] },
    }, testDir);

    await storage.upsertEntity({
      id: "b",
      type: "project",
      slug: "project:test",
      name: "test",
      first_seen: "2025-01-01",
      last_seen: "2025-02-01",
      mention_count: 2,
      sources: ["daily_note"],
      metadata: { paths: ["/new/path"], repo_names: ["test"] },
    }, testDir);

    const all = await storage.readAllEntities(testDir);
    expect(all).toHaveLength(1);
    expect(all[0].first_seen).toBe("2025-01-01");
    expect(all[0].last_seen).toBe("2025-03-01");
    expect(all[0].mention_count).toBe(3);
    expect(all[0].sources).toEqual(expect.arrayContaining(["git", "daily_note"]));
  });

  it("should union metadata arrays", async () => {
    await storage.upsertEntity({
      id: "a",
      type: "person",
      slug: "person:alice",
      name: "Alice",
      first_seen: "2025-01-01",
      last_seen: "2025-01-01",
      mention_count: 1,
      sources: ["git"],
      metadata: { aliases: ["alice-smith"], associated_projects: ["project:amber"] },
    }, testDir);

    await storage.upsertEntity({
      id: "b",
      type: "person",
      slug: "person:alice",
      name: "Alice",
      first_seen: "2025-01-05",
      last_seen: "2025-01-05",
      mention_count: 1,
      sources: ["daily_note"],
      metadata: { aliases: ["asmith"], associated_projects: ["project:other"] },
    }, testDir);

    const all = await storage.readAllEntities(testDir);
    const alice = all[0];
    expect(alice.metadata.aliases).toContain("alice-smith");
    expect(alice.metadata.aliases).toContain("asmith");
    expect(alice.metadata.associated_projects).toContain("project:amber");
    expect(alice.metadata.associated_projects).toContain("project:other");
  });
});
