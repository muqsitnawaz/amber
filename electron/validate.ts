import * as os from "os";
import * as path from "path";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_MCP_SOURCES = new Set([
  "claude_code",
  "cursor",
  "codex",
  "opencode",
  "user",
  "clawdbot",
  "gemini",
  "aider",
  "copilot",
]);

const ALLOWED_MCP_KINDS = new Set([
  "session",
  "commit",
  "note",
  "browse",
  "chat",
  "memory",
]);

const ALLOWED_FEEDBACK_TYPES = new Set([
  "outdated",
  "incorrect",
  "correction",
  "useful",
  "irrelevant",
]);

export function validateDate(date: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date format: "${date}". Expected YYYY-MM-DD.`);
  }
  const parsed = new Date(date + "T00:00:00");
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: "${date}".`);
  }
  return date;
}

export function validateConfig(config: Record<string, unknown>): void {
  const schedule = config.schedule as Record<string, unknown> | undefined;
  if (schedule) {
    if (schedule.daily_hour !== undefined) {
      const h = Number(schedule.daily_hour);
      if (!Number.isFinite(h) || h < 0 || h > 23) {
        throw new Error(`daily_hour must be 0-23, got ${schedule.daily_hour}`);
      }
    }
    if (schedule.ingest_minutes !== undefined) {
      const m = Number(schedule.ingest_minutes);
      if (!Number.isFinite(m) || m < 1 || m > 60) {
        throw new Error(`ingest_minutes must be 1-60, got ${schedule.ingest_minutes}`);
      }
    }
  }

  const storage = config.storage as Record<string, unknown> | undefined;
  if (storage?.base_dir !== undefined) {
    validateBaseDir(storage.base_dir as string);
  }

  const processing = config.processing as Record<string, unknown> | undefined;
  if (processing) {
    const provider = processing.provider as string | undefined;
    if (provider !== undefined && provider !== "claude" && provider !== "codex") {
      throw new Error(`processing.provider must be "claude" or "codex", got ${provider}`);
    }

    if (processing.model !== undefined && typeof processing.model !== "string") {
      throw new Error(`processing.model must be a string`);
    }

    if (processing.codex_command !== undefined && typeof processing.codex_command !== "string") {
      throw new Error(`processing.codex_command must be a string`);
    }

    if (processing.codex_args !== undefined) {
      if (!Array.isArray(processing.codex_args)) {
        throw new Error(`processing.codex_args must be an array`);
      }
      for (const arg of processing.codex_args) {
        if (typeof arg !== "string") {
          throw new Error(`processing.codex_args must contain only strings`);
        }
      }
    }
  }
}

export function validateMemoryInput(args: Record<string, unknown>): void {
  const source = args.source as string;
  if (!source || !ALLOWED_MCP_SOURCES.has(source)) {
    throw new Error(`Invalid source: "${source}". Allowed: ${[...ALLOWED_MCP_SOURCES].join(", ")}`);
  }

  const title = args.title as string;
  if (!title) {
    throw new Error("title is required.");
  }
  if (title.length > 500) {
    throw new Error(`title too long (${title.length} chars, max 500).`);
  }

  const detail = args.detail as string | undefined;
  if (detail && detail.length > 10000) {
    throw new Error(`detail too long (${detail.length} chars, max 10000).`);
  }

  const kind = args.kind as string | undefined;
  if (kind && !ALLOWED_MCP_KINDS.has(kind)) {
    throw new Error(`Invalid kind: "${kind}". Allowed: ${[...ALLOWED_MCP_KINDS].join(", ")}`);
  }
}

export function validateFeedbackType(feedbackType: string): void {
  if (!ALLOWED_FEEDBACK_TYPES.has(feedbackType)) {
    throw new Error(`Invalid feedback_type: "${feedbackType}". Allowed: ${[...ALLOWED_FEEDBACK_TYPES].join(", ")}`);
  }
}

export function validateSearchQuery(query: string, maxLength = 500): string {
  if (!query || typeof query !== "string") {
    throw new Error("query is required.");
  }
  if (query.length > maxLength) {
    return query.slice(0, maxLength);
  }
  return query;
}

export function validateBaseDir(baseDir: string): string {
  const home = os.homedir();
  const resolved = baseDir.startsWith("~")
    ? path.resolve(baseDir.replace(/^~/, home))
    : path.resolve(baseDir);
  if (!resolved.startsWith(home)) {
    throw new Error(`base_dir must be under home directory (${home}), got: ${resolved}`);
  }
  return resolved;
}
