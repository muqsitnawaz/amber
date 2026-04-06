/**
 * Unit tests for entity extraction
 */

import { describe, it, expect } from "vitest";
import { extractEntities, extractFromSessions } from "../electron/extractor";

describe("extractEntities", () => {
  describe("topic extraction", () => {
    it("extracts common tech terms", () => {
      const text = "Building a React app with TypeScript and GraphQL";
      const result = extractEntities(text, "s1", "2025-01-01");

      const topics = result.entities.filter(e => e.type === "topic");
      const names = topics.map(t => t.name.toLowerCase());

      expect(names).toContain("react");
      expect(names).toContain("typescript");
      expect(names).toContain("graphql");
    });

    it("handles case-insensitive matching", () => {
      const text = "Using REACT with TYPESCRIPT";
      const result = extractEntities(text, "s1", "2025-01-01");

      const topics = result.entities.filter(e => e.type === "topic");
      expect(topics.length).toBeGreaterThan(0);
    });

    it("captures context around terms", () => {
      const text = "The user was asking about implementing React hooks for state management";
      const result = extractEntities(text, "s1", "2025-01-01");

      const react = result.entities.find(e => e.name.toLowerCase() === "react");
      expect(react).toBeDefined();
      expect(react!.context.length).toBeGreaterThan(0);
      expect(react!.context).toContain("React");
    });
  });

  describe("project extraction", () => {
    it("extracts from directory paths", () => {
      const text = "Working in ~/projects/my-app";
      const result = extractEntities(text, "s1", "2025-01-01");

      const projects = result.entities.filter(e => e.type === "project");
      expect(projects.length).toBeGreaterThan(0);
    });

    it("extracts from GitHub URLs", () => {
      const text = "Check out github.com/acme/awesome-project for reference";
      const result = extractEntities(text, "s1", "2025-01-01");

      const projects = result.entities.filter(e => e.type === "project");
      const names = projects.map(p => p.name.toLowerCase());
      expect(names.some(n => n.includes("awesome"))).toBe(true);
    });

    it("extracts from working on context", () => {
      const text = "I'm working on MyProject to add new features";
      const result = extractEntities(text, "s1", "2025-01-01");

      const projects = result.entities.filter(e => e.type === "project");
      const names = projects.map(p => p.name);
      expect(names).toContain("MyProject");
    });
  });

  describe("person extraction", () => {
    it("extracts @mentions", () => {
      const text = "Ask @johndoe about this";
      const result = extractEntities(text, "s1", "2025-01-01");

      const people = result.entities.filter(e => e.type === "person");
      const names = people.map(p => p.name.toLowerCase());
      expect(names.some(n => n.includes("johndoe"))).toBe(true);
    });

    it("extracts names with context words", () => {
      const text = "I discussed this with Alice yesterday";
      const result = extractEntities(text, "s1", "2025-01-01");

      const people = result.entities.filter(e => e.type === "person");
      const names = people.map(p => p.name);
      expect(names).toContain("Alice");
    });

    it("extracts from email-like patterns", () => {
      const text = "Email from bob.smith@company.com about the issue";
      const result = extractEntities(text, "s1", "2025-01-01");

      const people = result.entities.filter(e => e.type === "person");
      expect(people.length).toBeGreaterThan(0);
    });

    it("does not extract tech terms as people", () => {
      const text = "I discussed React with someone";
      const result = extractEntities(text, "s1", "2025-01-01");

      const people = result.entities.filter(e => e.type === "person");
      const names = people.map(p => p.name.toLowerCase());
      expect(names).not.toContain("react");
    });
  });

  describe("deduplication", () => {
    it("does not duplicate same entity in one session", () => {
      const text = "React is great. I love React. React rocks.";
      const result = extractEntities(text, "s1", "2025-01-01");

      const reactEntities = result.entities.filter(
        e => e.name.toLowerCase() === "react"
      );
      expect(reactEntities.length).toBe(1);
    });
  });

  describe("confidence scores", () => {
    it("assigns confidence to entities", () => {
      const text = "Building a React app";
      const result = extractEntities(text, "s1", "2025-01-01");

      for (const entity of result.entities) {
        expect(entity.confidence).toBeGreaterThan(0);
        expect(entity.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty text", () => {
      const result = extractEntities("", "s1", "2025-01-01");
      expect(result.entities).toEqual([]);
    });

    it("handles text with no entities", () => {
      const text = "Hello, how are you today?";
      const result = extractEntities(text, "s1", "2025-01-01");
      // May find some entities or may not
      expect(Array.isArray(result.entities)).toBe(true);
    });

    it("handles very long text", () => {
      const text = "React ".repeat(1000);
      const result = extractEntities(text, "s1", "2025-01-01");

      // Should still only have one React entity
      const reactEntities = result.entities.filter(
        e => e.name.toLowerCase() === "react"
      );
      expect(reactEntities.length).toBe(1);
    });
  });
});

describe("extractFromSessions", () => {
  it("aggregates entities across sessions", () => {
    const sessions = [
      { id: "s1", timestamp: "2025-01-01", summary: "Working with React" },
      { id: "s2", timestamp: "2025-01-02", summary: "More React work" },
    ];

    const entityMap = extractFromSessions(sessions);

    const reactEntry = entityMap.get("topic:react");
    expect(reactEntry).toBeDefined();
    expect(reactEntry!.mentions.length).toBe(2);
    expect(reactEntry!.mentions[0].sessionId).toBe("s1");
    expect(reactEntry!.mentions[1].sessionId).toBe("s2");
  });

  it("boosts confidence with more mentions", () => {
    const sessions = [
      { id: "s1", timestamp: "2025-01-01", summary: "Working with React" },
      { id: "s2", timestamp: "2025-01-02", summary: "More React work" },
      { id: "s3", timestamp: "2025-01-03", summary: "React again" },
    ];

    const entityMap = extractFromSessions(sessions);

    const reactEntry = entityMap.get("topic:react");
    expect(reactEntry).toBeDefined();
    expect(reactEntry!.entity.confidence).toBeGreaterThan(0.8);
  });

  it("handles empty sessions array", () => {
    const entityMap = extractFromSessions([]);
    expect(entityMap.size).toBe(0);
  });
});
