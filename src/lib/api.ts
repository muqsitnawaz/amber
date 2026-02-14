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

export interface AppStatus {
  buffered_events: number;
  last_summarized: string | null;
}

export interface ContextEntry {
  id: string;
  source: string;
  timestamp: string;
  kind: string;
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
  kind: string;
  date: string;
  title: string;
  detail?: string;
  projectPath?: string;
  data: Record<string, unknown>;
  note?: string;
}

export interface SearchResult {
  date: string;
  entry: ContextEntry;
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

export const getConfig = (): Promise<AmberConfig> => window.amber.getConfig();
export const updateConfig = (config: AmberConfig): Promise<void> => window.amber.updateConfig(config);
export const getDailyNote = (date: string): Promise<string | null> => window.amber.getDailyNote(date);
export const getStatus = (): Promise<AppStatus> => window.amber.getStatus();
export const triggerSummarize = (): Promise<void> => window.amber.triggerSummarize();
export const getEntries = (date: string): Promise<ContextEntry[]> => window.amber.getEntries(date);
export const getEntryDates = (): Promise<string[]> => window.amber.getEntryDates();
export const getEntryCounts = (): Promise<Record<string, number>> => window.amber.getEntryCounts();
export const getSources = (): Promise<DetectedSource[]> => window.amber.getSources();
export const searchEntries = (query: string, limit?: number): Promise<SearchResult[]> => window.amber.searchEntries(query, limit);
export const addManualEntry = (title: string, detail?: string): Promise<void> => window.amber.addManualEntry(title, detail);

export interface AgentSource {
  id: string;
  name: string;
  dir: string;
  found: boolean;
  sessionCount: number;
  oldest?: string;
  newest?: string;
}

export interface ImportProgress {
  agentId: string;
  total: number;
  processed: number;
  imported: number;
  dates: string[];
}

export interface ProcessingProgress {
  current: string;
  index: number;
  total: number;
  status: "processing" | "done";
}

export interface SessionPreview {
  id: string;
  date: string;
  project?: string;
  firstMessage: string;
}

export const scanImportSources = (cutoffDays?: number): Promise<AgentSource[]> => window.amber.scanImportSources(cutoffDays);
export const runImport = (agentId: string, cutoffDays: number): Promise<ImportProgress> => window.amber.runImport(agentId, cutoffDays);
export const listAgentSessions = (agentId: string, cutoffDays?: number): Promise<SessionPreview[]> => window.amber.listAgentSessions(agentId, cutoffDays);
export const getMcpConnections = (): Promise<number> => window.amber.getMcpConnections();

export const pinEntry = (entry: ContextEntry, note?: string): Promise<PinRecord> => window.amber.pinEntry(entry, note);
export const unpinEntry = (pinId: string): Promise<void> => window.amber.unpinEntry(pinId);
export const getPins = (opts?: { date?: string; month?: string }): Promise<PinRecord[]> => window.amber.getPins(opts);

// ── Knowledge Base ──

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

export interface KnowledgeStats {
  projects: number;
  people: number;
  topics: number;
}

export const getKnowledge = (opts?: { type?: string }): Promise<KnowledgeEntity[]> => window.amber.getKnowledge(opts);
export const getKnowledgeStats = (): Promise<KnowledgeStats> => window.amber.getKnowledgeStats();
export const searchKnowledge = (query: string): Promise<KnowledgeEntity[]> => window.amber.searchKnowledge(query);
export const removeKnowledgeEntity = (id: string): Promise<void> => window.amber.removeKnowledgeEntity(id);
export const backfillKnowledge = (): Promise<{ processed: number; entities: number }> => window.amber.backfillKnowledge();

export const processDates = (dates: string[]): Promise<{ processed: number; failed: string[] }> =>
  window.amber.processDates(dates);

export const onProcessingProgress = (cb: (progress: ProcessingProgress) => void) =>
  window.amber.onProcessingProgress((_event: unknown, p: unknown) => cb(p as ProcessingProgress));

export const offProcessingProgress = () => window.amber.offProcessingProgress();
