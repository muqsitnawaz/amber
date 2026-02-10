import { useState, useEffect, useCallback } from "react";
import { getDailyNote, getStatus, triggerSummarize, type AppStatus } from "./lib/api";
import Settings from "./components/Settings";

type View = "dashboard" | "settings";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [noteResult, statusResult] = await Promise.all([
        getDailyNote(todayISO()),
        getStatus(),
      ]);
      setNote(noteResult);
      setStatus(statusResult);
    } catch {
      // Backend may not be ready yet
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      await triggerSummarize();
      // Refresh after a short delay to pick up new note
      setTimeout(fetchData, 2000);
    } catch {
      // Summarize may fail if not configured
    } finally {
      setSummarizing(false);
    }
  };

  if (view === "settings") {
    return <Settings onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Amber</h1>
          <span className="header-date">{formatDate(new Date())}</span>
        </div>
        <button
          className="btn-icon"
          onClick={() => setView("settings")}
          title="Settings"
        >
          &#9881;
        </button>
      </div>

      <div className="content">
        {note ? (
          <div className="note-content">{note}</div>
        ) : (
          <div className="placeholder">
            <span className="placeholder-icon">&#9672;</span>
            <span>No notes yet for today</span>
          </div>
        )}
      </div>

      <div className="status-bar">
        <div className="status-left">
          <span>
            <span
              className={`status-dot ${status?.watchers_running ? "active" : "inactive"}`}
            />
            {status?.watchers_running ? "Watching" : "Idle"}
          </span>
          <span>{status?.buffered_events ?? 0} buffered</span>
        </div>
        <button
          className="btn-summarize"
          onClick={handleSummarize}
          disabled={summarizing}
        >
          {summarizing ? "Running..." : "Summarize Now"}
        </button>
      </div>
    </div>
  );
}
