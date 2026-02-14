import { useState, useEffect, useCallback } from "react";
import {
  getKnowledge,
  searchKnowledge,
  removeKnowledgeEntity,
  backfillKnowledge,
  type KnowledgeEntity,
  type EntityType,
} from "../lib/api";

type Tab = EntityType;

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "project", label: "Projects" },
  { id: "person", label: "People" },
  { id: "topic", label: "Topics" },
];

function daysAgo(dateStr: string): string {
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86400000,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff}d ago`;
}

interface KnowledgeProps {
  initialTab?: Tab;
}

export default function Knowledge({ initialTab }: KnowledgeProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab || "project");
  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [counts, setCounts] = useState({ project: 0, person: 0, topic: 0 });
  const [search, setSearch] = useState("");
  const [rebuilding, setRebuilding] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const all = await getKnowledge();
      setEntities(all);
      setCounts({
        project: all.filter((e) => e.type === "project").length,
        person: all.filter((e) => e.type === "person").length,
        topic: all.filter((e) => e.type === "topic").length,
      });
    } catch {
      // Backend not ready
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!search) return;
    const timer = setTimeout(async () => {
      try {
        const results = await searchKnowledge(search);
        setEntities(results);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!search) {
      fetchData();
    }
  }, [search, fetchData]);

  const handleDelete = async (id: string) => {
    await removeKnowledgeEntity(id);
    await fetchData();
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await backfillKnowledge();
      await fetchData();
    } catch {
      // ignore
    } finally {
      setRebuilding(false);
    }
  };

  const filtered = entities
    .filter((e) => e.type === activeTab)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));

  return (
    <div className="knowledge-view">
      <div className="view-header">
        <div>
          <h1>Knowledge</h1>
          <span className="view-subtitle">
            {counts.project + counts.person + counts.topic} entities
          </span>
        </div>
        <div className="view-header-right">
          <div className="search-bar">
            <input
              className="search-input"
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch("")}>
                &times;
              </button>
            )}
          </div>
          <button
            className="btn-refresh"
            onClick={handleRebuild}
            disabled={rebuilding}
          >
            {rebuilding ? "Rebuilding..." : "Rebuild"}
          </button>
        </div>
      </div>

      <div className="knowledge-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`filter-pill ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="filter-count">
              {counts[tab.id]}
            </span>
          </button>
        ))}
      </div>

      <div className="knowledge-list">
        {filtered.length === 0 ? (
          <div className="entries-empty">
            No {activeTab}s found.
            {entities.length === 0 && " Click Rebuild to extract from daily notes."}
          </div>
        ) : (
          filtered.map((entity) => (
            <div key={entity.id} className="knowledge-card">
              <div className="knowledge-card-body">
                <div className="knowledge-card-name">{entity.name}</div>
                {entity.type === "project" && Array.isArray(entity.metadata.paths) && (entity.metadata.paths as string[]).length > 0 && (
                  <div className="knowledge-card-path">
                    {(entity.metadata.paths as string[])[0]}
                  </div>
                )}
                {(entity.type === "person" || entity.type === "topic") &&
                  Array.isArray(entity.metadata.associated_projects) &&
                  (entity.metadata.associated_projects as string[]).length > 0 && (
                    <div className="knowledge-card-projects">
                      {(entity.metadata.associated_projects as string[])
                        .map((s) => s.replace(/^project:/, ""))
                        .join(", ")}
                    </div>
                  )}
                <div className="knowledge-card-meta">
                  <span>{entity.sources.join(", ")}</span>
                  <span>{entity.mention_count}x</span>
                  <span>last {daysAgo(entity.last_seen)}</span>
                </div>
              </div>
              <button
                className="knowledge-delete-btn"
                onClick={() => handleDelete(entity.id)}
                title="Remove entity"
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
