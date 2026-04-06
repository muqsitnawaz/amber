/**
 * Entity extraction from session text.
 * No LLM needed - uses pattern matching to identify:
 * - Projects: directory paths, repo names, package names
 * - People: @mentions, names with titles, email-like patterns
 * - Topics: technologies, frameworks, concepts
 */

export interface ExtractedEntity {
  name: string;
  type: "project" | "person" | "topic";
  confidence: number; // 0-1
  context: string; // surrounding text for later compilation
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  sessionId: string;
  timestamp: string;
}

// Common tech terms that indicate topics
const TECH_TERMS = new Set([
  "react", "vue", "angular", "svelte", "nextjs", "next.js", "nuxt", "remix",
  "typescript", "javascript", "python", "rust", "go", "golang", "java", "kotlin",
  "swift", "ruby", "rails", "django", "fastapi", "flask", "express", "nestjs",
  "graphql", "rest", "api", "database", "postgres", "postgresql", "mysql", "mongodb",
  "redis", "elasticsearch", "docker", "kubernetes", "k8s", "aws", "gcp", "azure",
  "terraform", "ansible", "ci/cd", "github", "gitlab", "git", "npm", "yarn", "pnpm",
  "webpack", "vite", "esbuild", "rollup", "tailwind", "css", "html", "node", "deno", "bun",
  "electron", "tauri", "mobile", "ios", "android", "flutter", "react native",
  "testing", "jest", "vitest", "playwright", "cypress", "selenium",
  "authentication", "auth", "oauth", "jwt", "security", "encryption",
  "machine learning", "ml", "ai", "llm", "gpt", "claude", "anthropic", "openai",
  "vector", "embeddings", "rag", "langchain", "llamaindex",
  "supabase", "firebase", "vercel", "netlify", "cloudflare",
]);

// Patterns for project detection
const PROJECT_PATTERNS = [
  // Directory paths
  /(?:^|[\s"'`])(?:~\/|\.\/|\/Users\/|\/home\/)[^\s"'`]+\/([a-zA-Z][a-zA-Z0-9_-]+)/g,
  // GitHub/GitLab repos
  /(?:github\.com|gitlab\.com)\/[a-zA-Z0-9_-]+\/([a-zA-Z][a-zA-Z0-9_-]+)/gi,
  // Package names in context
  /(?:package|project|repo|repository|codebase)[:\s]+["']?([a-zA-Z][a-zA-Z0-9_-]+)["']?/gi,
  // Working on / building
  /(?:working on|building|developing|implementing)\s+(?:the\s+)?([A-Z][a-zA-Z0-9_-]+)/g,
];

// Patterns for person detection
const PERSON_PATTERNS = [
  // @mentions
  /@([a-zA-Z][a-zA-Z0-9_]+)/g,
  // Names with context
  /(?:with|from|by|ask|told|said|mentioned|contact|email|message)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  // Email-like (extract name part)
  /([a-zA-Z][a-zA-Z0-9.]+)@[a-zA-Z0-9.-]+\.[a-z]+/gi,
];

export function extractEntities(text: string, sessionId: string, timestamp: string): ExtractionResult {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Normalize text for matching
  const normalized = text.toLowerCase();

  // Extract topics from tech terms
  for (const term of TECH_TERMS) {
    if (normalized.includes(term)) {
      const key = `topic:${term}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Find context around the term
        const idx = normalized.indexOf(term);
        const start = Math.max(0, idx - 50);
        const end = Math.min(text.length, idx + term.length + 50);
        const context = text.slice(start, end).trim();

        entities.push({
          name: capitalizeFirst(term),
          type: "topic",
          confidence: 0.8,
          context,
        });
      }
    }
  }

  // Extract projects
  for (const pattern of PROJECT_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      if (!name || name.length < 2 || name.length > 50) continue;
      if (isCommonWord(name)) continue;

      const key = `project:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        const idx = match.index;
        const start = Math.max(0, idx - 30);
        const end = Math.min(text.length, idx + match[0].length + 30);

        entities.push({
          name,
          type: "project",
          confidence: 0.7,
          context: text.slice(start, end).trim(),
        });
      }
    }
  }

  // Extract people
  for (const pattern of PERSON_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      if (!name || name.length < 2 || name.length > 40) continue;
      if (isCommonWord(name)) continue;
      // Skip if it looks like a tech term
      if (TECH_TERMS.has(name.toLowerCase())) continue;

      const key = `person:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        const idx = match.index;
        const start = Math.max(0, idx - 30);
        const end = Math.min(text.length, idx + match[0].length + 30);

        entities.push({
          name: capitalizeName(name),
          type: "person",
          confidence: 0.6,
          context: text.slice(start, end).trim(),
        });
      }
    }
  }

  return { entities, sessionId, timestamp };
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function capitalizeName(str: string): string {
  return str.split(/\s+/).map(capitalizeFirst).join(" ");
}

const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "must", "can", "this", "that", "these", "those",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "what", "which", "who", "whom",
  "and", "or", "but", "if", "then", "else", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some", "such",
  "no", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "also", "now", "here", "there", "then", "once", "again",
  "user", "assistant", "system", "error", "warning", "info", "debug",
  "true", "false", "null", "undefined", "none", "yes", "no",
  "file", "files", "folder", "directory", "path", "line", "lines",
  "function", "class", "method", "variable", "const", "let", "var",
  "import", "export", "default", "return", "async", "await",
  "new", "delete", "update", "create", "read", "write", "get", "set", "add", "remove",
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}

/**
 * Extract entities from multiple sessions and deduplicate
 */
export function extractFromSessions(
  sessions: Array<{ id: string; timestamp: string; summary: string }>
): Map<string, { entity: ExtractedEntity; mentions: Array<{ sessionId: string; context: string; timestamp: string }> }> {
  const entityMap = new Map<string, {
    entity: ExtractedEntity;
    mentions: Array<{ sessionId: string; context: string; timestamp: string }>;
  }>();

  for (const session of sessions) {
    const result = extractEntities(session.summary, session.id, session.timestamp);

    for (const entity of result.entities) {
      const key = `${entity.type}:${entity.name.toLowerCase()}`;
      const existing = entityMap.get(key);

      if (existing) {
        existing.mentions.push({
          sessionId: session.id,
          context: entity.context,
          timestamp: session.timestamp,
        });
        // Boost confidence with more mentions
        existing.entity.confidence = Math.min(1, existing.entity.confidence + 0.1);
      } else {
        entityMap.set(key, {
          entity,
          mentions: [{
            sessionId: session.id,
            context: entity.context,
            timestamp: session.timestamp,
          }],
        });
      }
    }
  }

  return entityMap;
}
