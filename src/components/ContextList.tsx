import { useState, useEffect, useRef, useCallback } from "react";
import { getEntries, getEntryCounts, searchEntries, addManualEntry, pinEntry, unpinEntry, type ContextEntry, type SearchResult } from "../lib/api";
import { sourceLabels, sourceColors } from "../lib/constants";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const today = todayISO();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getHour(timestamp: string): number {
  try {
    return new Date(timestamp).getHours();
  } catch {
    return 0;
  }
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function heatLevel(count: number): string {
  if (count <= 0) return "";
  if (count <= 5) return "cal-day-heat-1";
  if (count <= 15) return "cal-day-heat-2";
  if (count <= 30) return "cal-day-heat-3";
  return "cal-day-heat-4";
}

// ── Entry Card ──

function EntryCard({ entry, onPin, onUnpin }: { entry: ContextEntry; onPin?: (e: ContextEntry) => void; onUnpin?: (pinId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = sourceColors[entry.source] ?? "#8e8e93";
  const label = sourceLabels[entry.source] ?? entry.source;
  const hasData = entry.data && Object.keys(entry.data).length > 0;

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entry.pinned && entry.pinId && onUnpin) {
      onUnpin(entry.pinId);
    } else if (!entry.pinned && onPin) {
      onPin(entry);
    }
  };

  return (
    <div
      className={`entry-card ${expanded ? "entry-card-expanded" : ""} ${entry.pinned ? "entry-card-pinned" : ""}`}
      onClick={() => hasData && setExpanded(!expanded)}
      style={{ cursor: hasData ? "pointer" : "default", "--entry-source-color": color } as React.CSSProperties}
    >
      <div className="entry-time">{formatTime(entry.timestamp)}</div>
      <div className="entry-body">
        <div className="entry-source">
          <span className="entry-source-dot" style={{ background: color }} />
          {label}
        </div>
        <div className="entry-title">{entry.title}</div>
        {entry.detail && <div className="entry-detail">{entry.detail}</div>}
        {entry.projectPath && (
          <div className="entry-project">{entry.projectPath}</div>
        )}
        {entry.source === "chrome" || entry.source === "safari" ? (
          <div className="entry-url">{(entry.data.url as string) ?? ""}</div>
        ) : null}
        <div className="entry-data-wrapper">
          {expanded && hasData && (
            <div className="entry-data">
              {Object.entries(entry.data).map(([key, value]) => (
                <div key={key} className="entry-data-row">
                  <span className="entry-data-key">{key}</span>
                  <span className="entry-data-value">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(onPin || onUnpin) && (
        <button
          className={`pin-btn ${entry.pinned ? "pinned" : ""}`}
          onClick={handlePin}
          title={entry.pinned ? "Unpin" : "Pin"}
        >
          {entry.pinned ? "\u25C6" : "\u25C7"}
        </button>
      )}
    </div>
  );
}

// ── Source Breakdown Bar ──

function SourceBar({ entries }: { entries: ContextEntry[] }) {
  if (entries.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.source] = (counts[e.source] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.length;

  return (
    <div className="source-bar">
      <div className="source-bar-track">
        {sorted.map(([source, count]) => (
          <div
            key={source}
            className="source-bar-segment"
            style={{
              width: `${(count / total) * 100}%`,
              background: sourceColors[source] ?? "#8e8e93",
              opacity: 0.75,
            }}
          />
        ))}
      </div>
      <div className="source-bar-labels">
        {sorted.slice(0, 4).map(([source, count]) => (
          <span key={source} className="source-bar-label">
            <span className="source-bar-dot" style={{ background: sourceColors[source] ?? "#8e8e93" }} />
            {sourceLabels[source] ?? source} {Math.round((count / total) * 100)}%
          </span>
        ))}
        {sorted.length > 4 && (
          <span className="source-bar-label">+{sorted.length - 4}</span>
        )}
      </div>
    </div>
  );
}

// ── Timeline View ──

function TimelineView({ entries, onPin, onUnpin }: {
  entries: ContextEntry[];
  onPin: (e: ContextEntry) => void;
  onUnpin: (pinId: string) => void;
}) {
  // Group entries by hour
  const hourGroups: Map<number, ContextEntry[]> = new Map();
  for (const entry of entries) {
    const hour = getHour(entry.timestamp);
    if (!hourGroups.has(hour)) hourGroups.set(hour, []);
    hourGroups.get(hour)!.push(entry);
  }

  const sortedHours = Array.from(hourGroups.keys()).sort((a, b) => b - a);

  return (
    <div className="timeline">
      {sortedHours.map((hour) => (
        <div key={hour} className="timeline-hour">
          <div className="hour-divider">
            <span className="hour-label">{formatHour(hour)}</span>
            <span className="hour-line" />
          </div>
          {hourGroups.get(hour)!.map((entry) => (
            <div key={entry.id} className="timeline-entry">
              <span
                className="timeline-node"
                style={{ "--entry-source-color": sourceColors[entry.source] ?? "#8e8e93", background: sourceColors[entry.source] ?? "#8e8e93" } as React.CSSProperties}
              />
              <EntryCard entry={entry} onPin={onPin} onUnpin={onUnpin} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Heatmap Calendar ──

function getMonthDays(year: number, month: number): { date: string; day: number; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: { date: string; day: number; inMonth: boolean }[] = [];

  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: iso, day: d, inMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: iso, day: d, inMonth: true });
  }

  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      const m = month + 2 > 12 ? 1 : month + 2;
      const y = month + 2 > 12 ? year + 1 : year;
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date: iso, day: d, inMonth: false });
    }
  }

  return cells;
}

// ── Single Month Grid (reusable) ──

function MonthGrid({
  year,
  month,
  selectedDate,
  entryCounts,
  onSelect,
  dimmed,
}: {
  year: number;
  month: number;
  selectedDate: string;
  entryCounts: Record<string, number>;
  onSelect: (date: string) => void;
  dimmed?: boolean;
}) {
  const today = todayISO();
  const cells = getMonthDays(year, month);
  const monthLabel = new Date(year, month).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className={`cal-month ${dimmed ? "cal-month-dimmed" : ""}`}>
      <div className="cal-month-title">{monthLabel}</div>
      <div className="cal-weekdays">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="cal-weekday">{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => {
          const isSelected = cell.date === selectedDate;
          const isToday = cell.date === today;
          const isFuture = cell.date > today;
          const count = entryCounts[cell.date] || 0;

          return (
            <button
              key={cell.date}
              className={[
                "cal-day",
                !cell.inMonth && "cal-day-outside",
                isSelected && "cal-day-selected",
                isToday && "cal-day-today",
                isFuture && "cal-day-future",
                cell.inMonth && !isSelected && heatLevel(count),
              ].filter(Boolean).join(" ")}
              onClick={() => !isFuture && onSelect(cell.date)}
              disabled={isFuture}
            >
              {cell.day}
              {count > 0 && <span className="cal-day-count">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Three-Month Heatmap Calendar ──

function offsetMonth(year: number, month: number, delta: number): [number, number] {
  let m = month + delta;
  let y = year;
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  return [y, m];
}

function HeatmapCalendar({
  selectedDate,
  entryCounts,
  onSelect,
}: {
  selectedDate: string;
  entryCounts: Record<string, number>;
  onSelect: (date: string) => void;
}) {
  const [viewYear, setViewYear] = useState(() => parseInt(selectedDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => parseInt(selectedDate.slice(5, 7)) - 1);
  const [fading, setFading] = useState(false);
  const today = todayISO();
  const todayYear = parseInt(today.slice(0, 4));
  const todayMonth = parseInt(today.slice(5, 7)) - 1;

  useEffect(() => {
    setViewYear(parseInt(selectedDate.slice(0, 4)));
    setViewMonth(parseInt(selectedDate.slice(5, 7)) - 1);
  }, [selectedDate]);

  const goMonth = (delta: number) => {
    setFading(true);
    setTimeout(() => {
      const [y, m] = offsetMonth(viewYear, viewMonth, delta);
      setViewYear(y);
      setViewMonth(m);
      setFading(false);
    }, 150);
  };

  const [prevY, prevM] = offsetMonth(viewYear, viewMonth, -1);
  const [nextY, nextM] = offsetMonth(viewYear, viewMonth, 1);
  const nextMonthIsFuture = nextY > todayYear || (nextY === todayYear && nextM > todayMonth);

  return (
    <div className="tri-calendar">
      <div className="tri-calendar-nav">
        <button className="cal-nav" onClick={() => goMonth(-1)}>&lsaquo;</button>
        <button
          className="cal-nav"
          onClick={() => goMonth(1)}
          disabled={nextMonthIsFuture}
        >
          &rsaquo;
        </button>
      </div>
      <div className={`tri-calendar-grid ${fading ? "fading" : ""}`}>
        <MonthGrid
          year={prevY} month={prevM}
          selectedDate={selectedDate}
          entryCounts={entryCounts}
          onSelect={onSelect}
          dimmed
        />
        <MonthGrid
          year={viewYear} month={viewMonth}
          selectedDate={selectedDate}
          entryCounts={entryCounts}
          onSelect={onSelect}
        />
        {!nextMonthIsFuture ? (
          <MonthGrid
            year={nextY} month={nextM}
            selectedDate={selectedDate}
            entryCounts={entryCounts}
            onSelect={onSelect}
            dimmed
          />
        ) : (
          <div className="cal-month cal-month-dimmed" />
        )}
      </div>
    </div>
  );
}

// ── Main Context List ──

interface ContextListProps {
  initialFilter?: string;
  initialDate?: string;
}

export default function ContextList({ initialFilter, initialDate }: ContextListProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate || todayISO());
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(initialFilter || null);
  const [groupBySource, setGroupBySource] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [entriesFading, setEntriesFading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasBackend = typeof window !== "undefined" && Boolean((window as { amber?: unknown }).amber);

  useEffect(() => {
    if (!hasBackend) return;
    getEntryCounts().then(setEntryCounts).catch(() => {});
  }, []);

  useEffect(() => {
    // Fade out, load, fade in
    setEntriesFading(true);
    const timeout = setTimeout(() => {
      if (!hasBackend) {
        setEntries([]);
        setEntriesFading(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      getEntries(selectedDate)
        .then((data) => {
          setEntries(data);
          setEntriesFading(false);
        })
        .catch(() => { setEntries([]); setEntriesFading(false); })
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(timeout);
  }, [selectedDate]);

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setSearchResults(null);
    setSearchQuery("");
  };

  const handleSearch = useCallback((q: string) => {
    if (!hasBackend) {
      setSearchResults([]);
      return;
    }
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchEntries(q, 50);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
  };

  const handlePin = async (entry: ContextEntry) => {
    if (!hasBackend) return;
    try {
      await pinEntry(entry);
      const refreshed = await getEntries(selectedDate);
      setEntries(refreshed);
    } catch {
      // may fail
    }
  };

  const handleUnpin = async (pinId: string) => {
    if (!hasBackend) return;
    try {
      await unpinEntry(pinId);
      const refreshed = await getEntries(selectedDate);
      setEntries(refreshed);
    } catch {
      // may fail
    }
  };

  const handleAddEntry = async () => {
    if (!hasBackend) return;
    if (!newTitle.trim()) return;
    setAddingEntry(true);
    try {
      await addManualEntry(newTitle.trim(), newDetail.trim() || undefined);
      setNewTitle("");
      setNewDetail("");
      setShowAddForm(false);
      const refreshed = await getEntries(selectedDate);
      setEntries(refreshed);
      // Update counts
      getEntryCounts().then(setEntryCounts).catch(() => {});
    } catch {
      // may fail
    } finally {
      setAddingEntry(false);
    }
  };

  const pinnedEntries = entries.filter(e => e.pinned);
  const availableSources = Array.from(new Set(entries.map((e) => e.source)));
  const filteredEntries = activeFilter
    ? entries.filter((e) => e.source === activeFilter)
    : entries;

  const groupedEntries = groupBySource
    ? availableSources
        .filter((s) => !activeFilter || s === activeFilter)
        .map((source) => ({
          source,
          entries: filteredEntries.filter((e) => e.source === source),
        }))
        .filter((g) => g.entries.length > 0)
    : null;

  const isSearchActive = searchResults !== null;
  const useTimeline = !groupBySource && !isSearchActive;

  return (
    <div className="context-view">
      <div className="view-header">
        <div className="view-header-left">
          <h1>Context</h1>
          <div className="view-header-actions">
            <button
              className={`btn-icon ${groupBySource ? "active" : ""}`}
              onClick={() => setGroupBySource(!groupBySource)}
              title="Group by source"
            >
              &#x229E;
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowAddForm(!showAddForm)}
              title="Add memory"
            >
              +
            </button>
          </div>
        </div>
        <div className="view-header-right">
          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              placeholder="Search across dates..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={clearSearch}>&times;</button>
            )}
          </div>
          <div className="date-nav">
            <button className="date-nav-btn" onClick={() => {
              const d = new Date(selectedDate + "T12:00:00");
              d.setDate(d.getDate() - 1);
              selectDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
            }}>&larr;</button>
            <button
              className={`date-nav-label-btn ${showCalendar ? "active" : ""}`}
              onClick={() => setShowCalendar(!showCalendar)}
            >
              {formatDateLabel(selectedDate)}
              <span className="date-nav-caret">{showCalendar ? "\u25B4" : "\u25BE"}</span>
            </button>
            <button
              className="date-nav-btn"
              onClick={() => {
                const d = new Date(selectedDate + "T12:00:00");
                d.setDate(d.getDate() + 1);
                selectDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
              }}
              disabled={selectedDate >= todayISO()}
            >&rarr;</button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="add-entry-form">
          <input
            type="text"
            className="add-entry-title"
            placeholder="What do you want to remember?"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddEntry()}
            maxLength={500}
          />
          <textarea
            className="add-entry-detail"
            placeholder="Optional detail..."
            value={newDetail}
            onChange={(e) => setNewDetail(e.target.value)}
            rows={2}
            maxLength={10000}
          />
          <div className="add-entry-actions">
            <button
              className="btn-save"
              onClick={handleAddEntry}
              disabled={!newTitle.trim() || addingEntry}
            >
              {addingEntry ? "Saving..." : "Save"}
            </button>
            <button className="btn-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Heatmap calendar (toggled) */}
      {!isSearchActive && showCalendar && (
        <HeatmapCalendar
          selectedDate={selectedDate}
          entryCounts={entryCounts}
          onSelect={(d) => { selectDate(d); setShowCalendar(false); }}
        />
      )}

      {/* Source breakdown bar */}
      {!isSearchActive && !loading && <SourceBar entries={filteredEntries} />}

      {!isSearchActive && availableSources.length > 1 && (
        <div className="filter-pills">
          <button
            className={`filter-pill ${activeFilter === null ? "active" : ""}`}
            onClick={() => setActiveFilter(null)}
          >
            All <span className="filter-count">{entries.length}</span>
          </button>
          {availableSources.map((source) => {
            const color = sourceColors[source] ?? "#8e8e93";
            const label = sourceLabels[source] ?? source;
            const count = entries.filter((e) => e.source === source).length;
            return (
              <button
                key={source}
                className={`filter-pill ${activeFilter === source ? "active" : ""}`}
                onClick={() => setActiveFilter(activeFilter === source ? null : source)}
              >
                <span className="filter-dot" style={{ background: color }} />
                {label} <span className="filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={`entries-fade ${entriesFading ? "fading" : ""}`}>
        {isSearchActive ? (
          <div className="entries-list">
            {searching ? (
              <div className="entries-loading">Searching...</div>
            ) : searchResults!.length === 0 ? (
              <div className="entries-empty">
                <div className="empty-icon">&loz;</div>
                <p>No results for &ldquo;{searchQuery}&rdquo;</p>
                <p className="empty-hint">Try a different search term</p>
              </div>
            ) : (
              <>
                <div className="entries-count">{searchResults!.length} results</div>
                {searchResults!.map((result, i) => (
                  <div key={`${result.date}-${result.entry.id}-${i}`} className="search-result">
                    <div className="search-result-date">{formatDateLabel(result.date)}</div>
                    <EntryCard entry={result.entry} onPin={handlePin} onUnpin={handleUnpin} />
                  </div>
                ))}
              </>
            )}
          </div>
        ) : loading ? (
          <div className="entries-list">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="entries-list">
            <div className="entries-empty">
              <div className="empty-icon">&loz;</div>
              <p>No entries for {formatDateLabel(selectedDate)}</p>
              <p className="empty-hint">
                {selectedDate === todayISO()
                  ? "Entries appear as Amber detects activity"
                  : "Try selecting a different date"}
              </p>
            </div>
          </div>
        ) : groupedEntries ? (
          <div className="entries-list">
            <div className="entries-count">{filteredEntries.length} entries</div>
            {pinnedEntries.length > 0 && !activeFilter && (
              <div className="pinned-section">
                <div className="pinned-section-header">Pinned</div>
                {pinnedEntries.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} onPin={handlePin} onUnpin={handleUnpin} />
                ))}
              </div>
            )}
            {groupedEntries.map((group) => {
              const color = sourceColors[group.source] ?? "#8e8e93";
              const label = sourceLabels[group.source] ?? group.source;
              return (
                <div key={group.source} className="entry-group">
                  <div className="entry-group-header">
                    <span className="entry-source-dot" style={{ background: color }} />
                    {label}
                    <span className="filter-count">{group.entries.length}</span>
                  </div>
                  {group.entries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} onPin={handlePin} onUnpin={handleUnpin} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : useTimeline ? (
          <>
            <div className="entries-list">
              <div className="entries-count">{filteredEntries.length} entries</div>
              {pinnedEntries.length > 0 && !activeFilter && (
                <div className="pinned-section">
                  <div className="pinned-section-header">Pinned</div>
                  {pinnedEntries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} onPin={handlePin} onUnpin={handleUnpin} />
                  ))}
                </div>
              )}
            </div>
            <TimelineView entries={filteredEntries} onPin={handlePin} onUnpin={handleUnpin} />
          </>
        ) : (
          <div className="entries-list">
            <div className="entries-count">{filteredEntries.length} entries</div>
            {filteredEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onPin={handlePin} onUnpin={handleUnpin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
