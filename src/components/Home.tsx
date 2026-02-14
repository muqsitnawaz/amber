import { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import { getDailyNote, getStatus, getEntries, triggerSummarize, getPins, getKnowledgeStats, type AppStatus, type PinRecord, type KnowledgeStats } from "../lib/api";
import { sourceLabels, sourceColors } from "../lib/constants";
import type { NavigationState } from "../App";
import type { View } from "./Sidebar";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length).trim() : content;
}

interface HomeProps {
  onNavigate?: (state: Partial<NavigationState> & { view: View }) => void;
}

export default function Home({ onNavigate }: HomeProps) {
  const [note, setNote] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [monthPins, setMonthPins] = useState<PinRecord[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats>({ projects: 0, people: 0, topics: 0 });

  const currentMonth = todayISO().slice(0, 7);

  const fetchData = useCallback(async () => {
    try {
      const [noteResult, statusResult, entries, pins, kStats] = await Promise.all([
        getDailyNote(todayISO()),
        getStatus(),
        getEntries(todayISO()),
        getPins({ month: currentMonth }),
        getKnowledgeStats(),
      ]);
      setNote(noteResult);
      setStatus(statusResult);
      setEntryCount(entries.length);
      setMonthPins(pins);
      setKnowledgeStats(kStats);
    } catch {
      // Backend not ready
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      await triggerSummarize();
      setTimeout(fetchData, 2000);
    } catch {
      // may fail
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="home-view">
      <div className="view-header">
        <div>
          <h1>Home</h1>
          <span className="view-subtitle">{formatDate(new Date())}</span>
        </div>
        <button
          className={`btn-summarize ${summarizing ? "btn-breathing" : ""}`}
          onClick={handleSummarize}
          disabled={summarizing}
        >
          {summarizing ? "Running..." : "Summarize"}
        </button>
      </div>

      <div className="home-stats">
        <div
          className="stat-card stat-card-clickable"
          onClick={() => onNavigate?.({ view: "context" })}
        >
          <div className="stat-value">{entryCount}</div>
          <div className="stat-label">Entries today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{status?.buffered_events ?? 0}</div>
          <div className="stat-label">Buffered</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{status?.last_summarized ?? "Never"}</div>
          <div className="stat-label">Last summarized</div>
        </div>
      </div>

      {(knowledgeStats.projects > 0 || knowledgeStats.people > 0 || knowledgeStats.topics > 0) && (
        <div className="home-knowledge-stats">
          <div
            className="stat-card stat-card-clickable"
            onClick={() => onNavigate?.({ view: "knowledge", knowledgeTab: "project" })}
          >
            <div className="stat-value">{knowledgeStats.projects}</div>
            <div className="stat-label">Projects</div>
          </div>
          <div
            className="stat-card stat-card-clickable"
            onClick={() => onNavigate?.({ view: "knowledge", knowledgeTab: "person" })}
          >
            <div className="stat-value">{knowledgeStats.people}</div>
            <div className="stat-label">People</div>
          </div>
          <div
            className="stat-card stat-card-clickable"
            onClick={() => onNavigate?.({ view: "knowledge", knowledgeTab: "topic" })}
          >
            <div className="stat-value">{knowledgeStats.topics}</div>
            <div className="stat-label">Topics</div>
          </div>
        </div>
      )}

      {monthPins.length > 0 && (
        <div className="home-pins">
          <h3>Pinned This Month</h3>
          <div className="home-pins-list">
            {monthPins.map((pin) => {
              const color = sourceColors[pin.source] ?? "#8e8e93";
              const label = sourceLabels[pin.source] ?? pin.source;
              return (
                <div
                  key={pin.id}
                  className="pin-card"
                  onClick={() => onNavigate?.({ view: "context", contextDate: pin.date })}
                >
                  <div className="pin-card-date">{pin.date}</div>
                  <div className="pin-card-source">
                    <span className="entry-source-dot" style={{ background: color }} />
                    {label}
                  </div>
                  <div className="pin-card-title">{pin.title}</div>
                  {pin.note && <div className="pin-card-note">{pin.note}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="home-note">
        <h3>Today's Note</h3>
        {note ? (
          <div className="note-content">
            <Markdown
              disallowedElements={["script", "iframe", "object", "embed", "form"]}
              unwrapDisallowed={true}
              urlTransform={(url) =>
                url.startsWith("javascript:") || url.startsWith("data:text/html") ? "" : url
              }
            >{stripFrontmatter(note)}</Markdown>
          </div>
        ) : (
          <div className="home-empty">
            <p>No note yet. Click Summarize to generate today's context reference.</p>
          </div>
        )}
      </div>
    </div>
  );
}
