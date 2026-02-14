import { useState, useEffect } from "react";
import {
  getSources,
  scanImportSources,
  runImport,
  listAgentSessions,
  processDates,
  onProcessingProgress,
  offProcessingProgress,
  type DetectedSource,
  type AgentSource,
  type ImportProgress,
  type SessionPreview,
} from "../lib/api";

function formatRelativeDate(dateStr: string): string {
  const today = new Date();
  const date = new Date(dateStr + "T00:00:00");
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (date.getFullYear() === today.getFullYear()) {
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const typeLabels: Record<string, string> = {
  agent: "AI Agents",
  browser: "Browsers",
  knowledge: "Knowledge Bases",
  chat: "Chat Apps",
  email: "Email",
};

const typeOrder = ["agent", "browser", "knowledge", "chat", "email"];

const TIME_RANGES = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export default function Sources() {
  const [sources, setSources] = useState<DetectedSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Agent import state
  const [agents, setAgents] = useState<AgentSource[]>([]);
  const [scanning, setScanning] = useState(false);
  const [cutoffDays, setCutoffDays] = useState(7);
  const [importingAgent, setImportingAgent] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<Record<string, ImportProgress>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [sessionPreviews, setSessionPreviews] = useState<SessionPreview[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [processingState, setProcessingState] = useState<{
    agentId: string;
    current: string;
    index: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    getSources()
      .then(setSources)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setScanning(true);
    scanImportSources(cutoffDays)
      .then(setAgents)
      .catch(() => {})
      .finally(() => setScanning(false));
  }, [cutoffDays]);

  const toggleExpand = async (agentId: string) => {
    if (expandedAgent === agentId) {
      setExpandedAgent(null);
      setSessionPreviews([]);
      return;
    }
    setExpandedAgent(agentId);
    setLoadingPreviews(true);
    try {
      const previews = await listAgentSessions(agentId, cutoffDays);
      setSessionPreviews(previews);
    } catch {
      setSessionPreviews([]);
    }
    setLoadingPreviews(false);
  };

  const handleImportSingle = async (agentId: string) => {
    setImportingAgent(agentId);
    try {
      const result = await runImport(agentId, cutoffDays);
      setImportResults((prev) => ({ ...prev, [agentId]: result }));

      // Auto-process imported dates
      if (result.dates && result.dates.length > 0) {
        setProcessingState({ agentId, current: "", index: 0, total: result.dates.length });
        onProcessingProgress((progress) => {
          setProcessingState((prev) => prev ? { ...prev, ...progress } : null);
        });
        await processDates(result.dates);
        offProcessingProgress();
        setProcessingState(null);
      }
    } catch {
      setImportResults((prev) => ({
        ...prev,
        [agentId]: { agentId, total: 0, processed: 0, imported: 0, dates: [] },
      }));
    }
    setImportingAgent(null);
  };

  // Build agent lookup from scan results
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Detected agent sources (for description/path info)
  const agentSources = sources.filter((s) => s.type === "agent");
  const agentDetectedMap = new Map(agentSources.map((s) => [s.id, s]));

  // Non-agent source groups
  const nonAgentGroups = typeOrder
    .filter((type) => type !== "agent")
    .map((type) => ({
      type,
      label: typeLabels[type] || type,
      items: sources.filter((s) => s.type === type),
    }))
    .filter((g) => g.items.length > 0);

  // Detected agents not in the scanned list (edge case)
  const extraAgentSources = agentSources.filter((s) => !agentMap.has(s.id));

  const showAgentGroup = agents.length > 0 || extraAgentSources.length > 0;

  return (
    <div className="sources-view">
      <div className="view-header">
        <div>
          <h1>Sources</h1>
          <span className="view-subtitle">Manage data sources and import history</span>
        </div>
        <button className="btn-refresh" onClick={() => getSources().then(setSources)}>
          Refresh
        </button>
      </div>

      {/* ── Time Range Filter ── */}
      <div className="sources-time-range">
        <div className="import-range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.days}
              className={`import-range-btn ${cutoffDays === r.days ? "active" : ""}`}
              onClick={() => setCutoffDays(r.days)}
              disabled={importingAgent !== null}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && scanning ? (
        <div className="sources-loading">Detecting sources...</div>
      ) : (
        <div className="sources-list">
          {/* ── AI Agents ── */}
          {showAgentGroup && (
            <div className="source-group">
              <div className="source-group-title">{typeLabels.agent}</div>
              {scanning && <div className="source-scanning">Scanning...</div>}
              {agents.map((agent) => {
                const detected = agentDetectedMap.get(agent.id);
                const available = agent.found && agent.sessionCount > 0;
                const isExpanded = expandedAgent === agent.id;
                const isImporting = importingAgent === agent.id;
                const result = importResults[agent.id];

                return (
                  <div key={agent.id} className="source-card source-card-expandable">
                    <div className="source-card-main">
                      <div className="source-info">
                        <div className="source-name">
                          <span className={`source-status ${agent.found ? "detected" : "missing"}`} />
                          {agent.name}
                        </div>
                        {detected && (
                          <div className="source-description">{detected.description}</div>
                        )}
                        {available ? (
                          <div
                            className="source-meta source-meta-clickable"
                            onClick={() => toggleExpand(agent.id)}
                          >
                            <span>
                              {agent.sessionCount} sessions · {agent.oldest} – {agent.newest}
                            </span>
                            <span className={`expand-caret ${isExpanded ? "open" : ""}`}>
                              {isExpanded ? "▾" : "▸"}
                            </span>
                          </div>
                        ) : (
                          <div className="source-meta dimmed">
                            {agent.found ? "No sessions in range" : "Not installed"}
                          </div>
                        )}
                      </div>
                      <div className="source-card-actions">
                        {available ? (
                          <button
                            className={`btn-source-import ${isImporting ? "btn-breathing" : ""}`}
                            onClick={() => handleImportSingle(agent.id)}
                            disabled={isImporting || importingAgent !== null}
                          >
                            {isImporting
                              ? processingState?.agentId === agent.id
                                ? "Processing..."
                                : "Importing..."
                              : "Import"}
                          </button>
                        ) : (
                          <div className="source-badge">
                            {agent.found ? "No sessions" : "Not found"}
                          </div>
                        )}
                      </div>
                    </div>

                    {result && (
                      <div className="source-import-result">
                        {result.imported} of {result.total} sessions imported
                        {processingState && processingState.agentId === agent.id && (
                          <div className="source-processing-status">
                            Processing {processingState.index}/{processingState.total} dates...
                            {processingState.current && ` (${processingState.current})`}
                          </div>
                        )}
                      </div>
                    )}

                    {isExpanded && (
                      <div className="session-previews">
                        {loadingPreviews ? (
                          <div className="session-preview-loading">Loading sessions...</div>
                        ) : sessionPreviews.length === 0 ? (
                          <div className="session-preview-empty">No sessions found</div>
                        ) : (
                          sessionPreviews.map((s, i) => (
                            <div key={i} className="session-preview-row">
                              <div className="session-preview-top">
                                {s.project && <span className="session-preview-project">{s.project}</span>}
                                <span className="session-preview-date">{formatRelativeDate(s.date)}</span>
                              </div>
                              <div className="session-preview-msg">{s.firstMessage}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Detected agents not in scan results */}
              {extraAgentSources.map((source) => (
                <div key={source.id} className="source-card">
                  <div className="source-card-main">
                    <div className="source-info">
                      <div className="source-name">
                        <span className={`source-status ${source.detected ? "detected" : "missing"}`} />
                        {source.name}
                      </div>
                      <div className="source-description">{source.description}</div>
                      {source.path && <div className="source-path">{source.path}</div>}
                    </div>
                    <div className="source-badge">
                      {source.detected ? (source.enabled ? "Active" : "Available") : "Not found"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Non-Agent Groups ── */}
          {nonAgentGroups.map((group) => (
            <div key={group.type} className="source-group">
              <div className="source-group-title">{group.label}</div>
              {group.items.map((source) => (
                <div key={source.id} className="source-card">
                  <div className="source-card-main">
                    <div className="source-info">
                      <div className="source-name">
                        <span className={`source-status ${source.detected ? "detected" : "missing"}`} />
                        {source.name}
                      </div>
                      <div className="source-description">{source.description}</div>
                      {source.path && <div className="source-path">{source.path}</div>}
                    </div>
                    <div className="source-badge">
                      {source.detected ? (source.enabled ? "Active" : "Available") : "Not found"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
