import { useState, useEffect } from "react";
import { getConfig, updateConfig, type AmberConfig } from "../lib/api";

interface SettingsProps {
  onBack: () => void;
}

const defaultConfig: AmberConfig = {
  sources: {
    git: {
      watch_paths: [],
      scan_depth: 3,
      enabled: true,
    },
  },
  summarizer: {
    provider: "openai",
    model: "gpt-4o-mini",
    api_base: "https://api.openai.com/v1",
    api_key_env: "OPENAI_API_KEY",
  },
  schedule: {
    ingest_minutes: 5,
    daily_hour: 18,
  },
  storage: {
    base_dir: "",
  },
};

export default function Settings({ onBack }: SettingsProps) {
  const [config, setConfig] = useState<AmberConfig>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => {
        // Use defaults if config can't be loaded
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await updateConfig(config);
      setFeedback({ type: "success", msg: "Saved" });
    } catch (e) {
      setFeedback({ type: "error", msg: String(e) });
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const updateGit = (partial: Partial<AmberConfig["sources"]["git"]>) =>
    setConfig((c) => ({
      ...c,
      sources: { ...c.sources, git: { ...c.sources.git, ...partial } },
    }));

  const updateSummarizer = (partial: Partial<AmberConfig["summarizer"]>) =>
    setConfig((c) => ({ ...c, summarizer: { ...c.summarizer, ...partial } }));

  const updateSchedule = (partial: Partial<AmberConfig["schedule"]>) =>
    setConfig((c) => ({ ...c, schedule: { ...c.schedule, ...partial } }));

  const updateStorage = (partial: Partial<AmberConfig["storage"]>) =>
    setConfig((c) => ({ ...c, storage: { ...c.storage, ...partial } }));

  return (
    <div className="settings">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack} title="Back">
          &#8592;
        </button>
        <h2>Settings</h2>
      </div>

      <div className="settings-body">
        {/* Git Watcher */}
        <div className="section">
          <div className="section-title">Git Watcher</div>
          <div className="field">
            <label>Watch Paths (one per line)</label>
            <textarea
              value={config.sources.git.watch_paths.join("\n")}
              onChange={(e) =>
                updateGit({
                  watch_paths: e.target.value.split("\n").filter((p) => p.trim()),
                })
              }
              placeholder="/path/to/repo"
            />
          </div>
          <div className="field">
            <label>Scan Depth</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.sources.git.scan_depth}
              onChange={(e) => updateGit({ scan_depth: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <div className="field-row">
              <input
                type="checkbox"
                id="git-enabled"
                checked={config.sources.git.enabled}
                onChange={(e) => updateGit({ enabled: e.target.checked })}
              />
              <label htmlFor="git-enabled">Enabled</label>
            </div>
          </div>
        </div>

        {/* LLM Provider */}
        <div className="section">
          <div className="section-title">LLM Provider</div>
          <div className="field">
            <label>Provider</label>
            <input
              type="text"
              value={config.summarizer.provider}
              onChange={(e) => updateSummarizer({ provider: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Model</label>
            <input
              type="text"
              value={config.summarizer.model}
              onChange={(e) => updateSummarizer({ model: e.target.value })}
            />
          </div>
          <div className="field">
            <label>API Base URL</label>
            <input
              type="text"
              value={config.summarizer.api_base}
              onChange={(e) => updateSummarizer({ api_base: e.target.value })}
            />
          </div>
          <div className="field">
            <label>API Key Env Variable</label>
            <input
              type="text"
              value={config.summarizer.api_key_env}
              onChange={(e) => updateSummarizer({ api_key_env: e.target.value })}
            />
          </div>
        </div>

        {/* Schedule */}
        <div className="section">
          <div className="section-title">Schedule</div>
          <div className="field">
            <label>Ingest Interval (minutes)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={config.schedule.ingest_minutes}
              onChange={(e) =>
                updateSchedule({ ingest_minutes: Number(e.target.value) })
              }
            />
          </div>
          <div className="field">
            <label>Daily Summary Hour (0-23)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={config.schedule.daily_hour}
              onChange={(e) =>
                updateSchedule({ daily_hour: Number(e.target.value) })
              }
            />
          </div>
        </div>

        {/* Storage */}
        <div className="section">
          <div className="section-title">Storage</div>
          <div className="field">
            <label>Base Directory</label>
            <input
              type="text"
              value={config.storage.base_dir}
              onChange={(e) => updateStorage({ base_dir: e.target.value })}
              placeholder="~/.amber"
            />
          </div>
        </div>
      </div>

      <div className="settings-footer">
        <button className="btn-save" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        {feedback && (
          <span className={`save-feedback ${feedback.type}`}>{feedback.msg}</span>
        )}
      </div>
    </div>
  );
}
