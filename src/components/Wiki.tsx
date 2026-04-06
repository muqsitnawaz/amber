import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getWikiPages,
  getWikiPage,
  searchWiki,
  isWikiFirstLaunch,
  runWikiPipeline,
  onWikiPipelineProgress,
  offWikiPipelineProgress,
  type WikiPage,
  type PipelineProgress,
} from "../lib/api";

type WikiFilter = "all" | "project" | "person" | "topic";

type WikiToken =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "spacer" };

const filters: Array<{ id: WikiFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "project", label: "Projects" },
  { id: "person", label: "People" },
  { id: "topic", label: "Topics" },
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function tokenizeWikiContent(content: string): WikiToken[] {
  const lines = content.split(/\r?\n/);
  const tokens: WikiToken[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    tokens.push({ kind: "list", items: listBuffer });
    listBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      listBuffer.push(trimmed.slice(2));
      continue;
    }

    flushList();

    if (!trimmed) {
      tokens.push({ kind: "spacer" });
      continue;
    }

    if (trimmed.startsWith("### ")) {
      tokens.push({ kind: "heading", level: 3, text: trimmed.slice(4) });
      continue;
    }

    if (trimmed.startsWith("## ")) {
      tokens.push({ kind: "heading", level: 2, text: trimmed.slice(3) });
      continue;
    }

    if (trimmed.startsWith("# ")) {
      tokens.push({ kind: "heading", level: 1, text: trimmed.slice(2) });
      continue;
    }

    tokens.push({ kind: "paragraph", text: line });
  }

  flushList();

  return tokens;
}

export default function Wiki() {
  const [allPages, setAllPages] = useState<WikiPage[]>([]);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [filter, setFilter] = useState<WikiFilter>("all");
  const [search, setSearch] = useState("");
  const [loadingPage, setLoadingPage] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const hasCheckedFirstLaunch = useRef(false);

  const pageIndex = useMemo(() => {
    const index = new Map<string, WikiPage>();
    for (const page of allPages) {
      index.set(normalizeKey(page.title), page);
      index.set(normalizeKey(page.id), page);
    }
    return index;
  }, [allPages]);

  const counts = useMemo(() => {
    return {
      all: allPages.length,
      project: allPages.filter((p) => p.type === "project").length,
      person: allPages.filter((p) => p.type === "person").length,
      topic: allPages.filter((p) => p.type === "topic").length,
    };
  }, [allPages]);

  const fetchPages = useCallback(async () => {
    try {
      const all = await getWikiPages();
      setAllPages(all);
      setPages(all);
      return all;
    } catch {
      // Backend not ready
      return [];
    }
  }, []);

  // Auto-sync on first launch
  useEffect(() => {
    if (hasCheckedFirstLaunch.current) return;
    hasCheckedFirstLaunch.current = true;

    (async () => {
      const pages = await fetchPages();
      if (pages.length > 0) return; // Already have pages

      // Check if this is first launch with available data
      const isFirst = await isWikiFirstLaunch();
      if (!isFirst) return;

      // Auto-run pipeline
      setSyncing(true);
      setSyncMessage("Scanning your AI sessions...");

      const handleProgress = (progress: PipelineProgress) => {
        setSyncMessage(progress.message);
      };

      onWikiPipelineProgress(handleProgress);

      try {
        const result = await runWikiPipeline({ cutoffDays: 30 });
        if (result.pagesCreated > 0) {
          setSyncMessage(`Found ${result.pagesCreated} topics from ${result.sessionsScanned} sessions`);
          await fetchPages();
        } else {
          setSyncMessage(null);
        }
      } catch {
        setSyncMessage(null);
      } finally {
        offWikiPipelineProgress();
        setSyncing(false);
        // Clear message after a moment
        setTimeout(() => setSyncMessage(null), 3000);
      }
    })();
  }, [fetchPages]);

  useEffect(() => {
    if (!search) {
      fetchPages();
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await searchWiki(search);
        setPages(results);
      } catch {
        // ignore
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [search, fetchPages]);

  const filteredPages = useMemo(() => {
    if (filter === "all") return pages;
    return pages.filter((page) => page.type === filter);
  }, [pages, filter]);

  useEffect(() => {
    if (filteredPages.length === 0) {
      setSelectedId(null);
      setSelectedPage(null);
      return;
    }

    if (!selectedId || !filteredPages.some((page) => page.id === selectedId)) {
      setSelectedId(filteredPages[0].id);
    }
  }, [filteredPages, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedPage(null);
      return;
    }

    let active = true;
    setLoadingPage(true);

    (async () => {
      try {
        const page = await getWikiPage(selectedId);
        if (active) setSelectedPage(page);
      } catch {
        if (active) setSelectedPage(null);
      } finally {
        if (active) setLoadingPage(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedId]);

  const tokens = useMemo(() => {
    if (!selectedPage?.content) return [];
    return tokenizeWikiContent(selectedPage.content);
  }, [selectedPage?.content]);

  const handleLinkClick = (label: string) => {
    const match = pageIndex.get(normalizeKey(label));
    if (!match) return;
    setSelectedId(match.id);
  };

  const renderInline = (text: string) => {
    const parts = text.split(/(\[\[[^\]]+\]\])/g);
    return parts.map((part, index) => {
      if (part.startsWith("[[") && part.endsWith("]]")) {
        const label = part.slice(2, -2).trim();
        const target = pageIndex.get(normalizeKey(label));
        if (!target) {
          return (
            <span key={`${label}-${index}`} className="wiki-link wiki-link-missing">
              {label}
            </span>
          );
        }
        return (
          <button
            key={`${label}-${index}`}
            className="wiki-link"
            onClick={() => handleLinkClick(label)}
          >
            {label}
          </button>
        );
      }
      return <span key={`text-${index}`}>{part}</span>;
    });
  };

  // Show syncing state
  if (syncing) {
    return (
      <div className="wiki-view">
        <div className="view-header">
          <div>
            <h1>Wiki</h1>
            <span className="view-subtitle">Building your knowledge base...</span>
          </div>
        </div>
        <div className="wiki-sync-state">
          <div className="sync-spinner" />
          <p>{syncMessage || "Scanning sessions..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wiki-view">
      <div className="view-header">
        <div>
          <h1>Wiki</h1>
          <span className="view-subtitle">{counts.all} pages</span>
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
        </div>
      </div>

      <div className="wiki-toolbar">
        <div className="wiki-filters">
          {filters.map((tab) => (
            <button
              key={tab.id}
              className={`filter-pill ${filter === tab.id ? "active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              <span className="filter-count">{counts[tab.id]}</span>
            </button>
          ))}
        </div>
        <div className="wiki-count">{filteredPages.length} pages</div>
      </div>

      <div className="wiki-shell glass">
        <div className="wiki-grid">
          <div className="wiki-list glass-card">
            <div className="wiki-list-header">Page List</div>
            <div className="wiki-list-items">
              {filteredPages.length === 0 ? (
                <div className="entries-empty">No pages found.</div>
              ) : (
                filteredPages.map((page) => (
                  <button
                    key={page.id}
                    className={`wiki-list-item ${selectedId === page.id ? "active" : ""}`}
                    onClick={() => setSelectedId(page.id)}
                  >
                    <span className={`wiki-type wiki-type-${page.type}`}>
                      {page.type === "project" ? "P" : page.type === "person" ? "@" : "#"}
                    </span>
                    <span className="wiki-list-title">{page.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="wiki-detail glass-card">
            {loadingPage ? (
              <div className="entries-loading">Loading page...</div>
            ) : selectedPage ? (
              <div className="wiki-content">
                {tokens.length === 0 ? (
                  <div className="entries-empty">No content available.</div>
                ) : (
                  tokens.map((token, index) => {
                    if (token.kind === "spacer") {
                      return <div key={`spacer-${index}`} className="wiki-spacer" />;
                    }

                    if (token.kind === "list") {
                      return (
                        <ul key={`list-${index}`} className="wiki-list-block">
                          {token.items.map((item, itemIndex) => (
                            <li key={`item-${index}-${itemIndex}`}>{renderInline(item)}</li>
                          ))}
                        </ul>
                      );
                    }

                    if (token.kind === "heading") {
                      const Heading = token.level === 1 ? "h1" : token.level === 2 ? "h2" : "h3";
                      return <Heading key={`heading-${index}`}>{renderInline(token.text)}</Heading>;
                    }

                    return (
                      <p key={`para-${index}`}>{renderInline(token.text)}</p>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="entries-empty">Select a page to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
