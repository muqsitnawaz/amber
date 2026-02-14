export interface AmberConfig {
  schedule: {
    ingest_minutes: number;
    daily_hour: number;
  };
  storage: {
    base_dir: string;
  };
  agent_sessions?: {
    claude_code?: boolean;
    clawdbot?: boolean;
    codex?: boolean;
    opencode?: boolean;
    custom_paths?: string[];
  };
  browser_history?: {
    chrome?: boolean;
    safari?: boolean;
  };
  obsidian?: {
    enabled?: boolean;
    vault_paths?: string[];
  };
  notion?: {
    enabled?: boolean;
    api_key?: string;
  };
  email?: {
    enabled?: boolean;
  };
  mcp_server?: {
    enabled?: boolean;
  };
  processing?: {
    provider?: "claude" | "codex";
    model?: string;
    codex_command?: string;
    codex_args?: string[];
  };
}

export interface RawEvent {
  source: string;
  timestamp: string;
  kind: EventKind;
  data: Record<string, unknown>;
}

export type EventKind = "commit" | "session" | "browse" | "chat" | "note" | "memory";

export interface ContextEntry {
  id: string;
  source: string;
  timestamp: string;
  kind: EventKind;
  title: string;
  detail?: string;
  projectPath?: string;
  data: Record<string, unknown>;
  pinned?: boolean;
  pinId?: string;
}

export interface PinRecord {
  id: string;
  timestamp: string;
  source: string;
  kind: EventKind;
  date: string;
  title: string;
  detail?: string;
  projectPath?: string;
  data: Record<string, unknown>;
  note?: string;
}

export interface DetectedSource {
  id: string;
  name: string;
  type: "agent" | "browser" | "chat" | "knowledge" | "email";
  detected: boolean;
  enabled: boolean;
  path?: string;
  description: string;
  entryCount?: number;
}

export type EntityType = "project" | "person" | "topic";

export interface KnowledgeEntity {
  id: string;
  type: EntityType;
  slug: string;
  name: string;
  first_seen: string;
  last_seen: string;
  mention_count: number;
  sources: string[];
  metadata: Record<string, unknown>;
}

export interface AgentUpsertInput {
  type: EntityType;
  name: string;
  source: string;
  date: string;
  metadata?: Record<string, unknown>;
}

export interface AppStatus {
  buffered_events: number;
  last_summarized: string | null;
}
