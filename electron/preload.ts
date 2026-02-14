import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("amber", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  updateConfig: (config: unknown) => ipcRenderer.invoke("update-config", config),
  getDailyNote: (date: string) => ipcRenderer.invoke("get-daily-note", date),
  getStatus: () => ipcRenderer.invoke("get-status"),
  triggerSummarize: () => ipcRenderer.invoke("trigger-summarize"),
  getEntries: (date: string) => ipcRenderer.invoke("get-entries", date),
  getEntryDates: () => ipcRenderer.invoke("get-entry-dates"),
  getEntryCounts: () => ipcRenderer.invoke("get-entry-counts"),
  getSources: () => ipcRenderer.invoke("get-sources"),
  searchEntries: (query: string, limit?: number) => ipcRenderer.invoke("search-entries", query, limit),
  addManualEntry: (title: string, detail?: string) => ipcRenderer.invoke("add-manual-entry", title, detail),
  scanImportSources: (cutoffDays?: number) => ipcRenderer.invoke("scan-import-sources", cutoffDays),
  runImport: (agentId: string, cutoffDays: number) => ipcRenderer.invoke("run-import", agentId, cutoffDays),
  listAgentSessions: (agentId: string, cutoffDays?: number) => ipcRenderer.invoke("list-agent-sessions", agentId, cutoffDays),
  getMcpConnections: () => ipcRenderer.invoke("get-mcp-connections"),
  pinEntry: (entry: unknown, note?: string) => ipcRenderer.invoke("pin-entry", entry, note),
  unpinEntry: (pinId: string) => ipcRenderer.invoke("unpin-entry", pinId),
  getPins: (opts?: { date?: string; month?: string }) => ipcRenderer.invoke("get-pins", opts),
  getKnowledge: (opts?: { type?: string }) => ipcRenderer.invoke("get-knowledge", opts),
  getKnowledgeStats: () => ipcRenderer.invoke("get-knowledge-stats"),
  searchKnowledge: (query: string) => ipcRenderer.invoke("search-knowledge", query),
  removeKnowledgeEntity: (id: string) => ipcRenderer.invoke("remove-knowledge-entity", id),
  backfillKnowledge: () => ipcRenderer.invoke("backfill-knowledge"),
  processDates: (dates: string[]) => ipcRenderer.invoke("process-dates", dates),
  onProcessingProgress: (cb: (_: unknown, p: unknown) => void) => {
    ipcRenderer.on("processing-progress", cb);
  },
  offProcessingProgress: () => {
    ipcRenderer.removeAllListeners("processing-progress");
  },
});
