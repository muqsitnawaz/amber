interface AmberBridge {
  getConfig(): Promise<import("./lib/api").AmberConfig>;
  updateConfig(config: import("./lib/api").AmberConfig): Promise<void>;
  getDailyNote(date: string): Promise<string | null>;
  getStatus(): Promise<import("./lib/api").AppStatus>;
  triggerSummarize(): Promise<void>;
  getEntries(date: string): Promise<import("./lib/api").ContextEntry[]>;
  getEntryDates(): Promise<string[]>;
  getEntryCounts(): Promise<Record<string, number>>;
  getSources(): Promise<import("./lib/api").DetectedSource[]>;
  searchEntries(query: string, limit?: number): Promise<import("./lib/api").SearchResult[]>;
  addManualEntry(title: string, detail?: string): Promise<void>;
  scanImportSources(cutoffDays?: number): Promise<import("./lib/api").AgentSource[]>;
  runImport(agentId: string, cutoffDays: number): Promise<import("./lib/api").ImportProgress>;
  listAgentSessions(agentId: string, cutoffDays?: number): Promise<import("./lib/api").SessionPreview[]>;
  getMcpConnections(): Promise<number>;
  pinEntry(entry: import("./lib/api").ContextEntry, note?: string): Promise<import("./lib/api").PinRecord>;
  unpinEntry(pinId: string): Promise<void>;
  getPins(opts?: { date?: string; month?: string }): Promise<import("./lib/api").PinRecord[]>;
  getKnowledge(opts?: { type?: string }): Promise<import("./lib/api").KnowledgeEntity[]>;
  getKnowledgeStats(): Promise<import("./lib/api").KnowledgeStats>;
  searchKnowledge(query: string): Promise<import("./lib/api").KnowledgeEntity[]>;
  removeKnowledgeEntity(id: string): Promise<void>;
  backfillKnowledge(): Promise<{ processed: number; entities: number }>;
  processDates(dates: string[]): Promise<{ processed: number; failed: string[] }>;
  onProcessingProgress(cb: (event: unknown, progress: unknown) => void): void;
  offProcessingProgress(): void;
}

interface Window {
  amber: AmberBridge;
}
