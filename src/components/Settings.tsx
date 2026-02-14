import { useState, useEffect } from "react";
import { getConfig, updateConfig, type AmberConfig } from "../lib/api";
import Sources from "./Sources";
import Clients from "./Clients";

const defaultConfig: AmberConfig = {
  schedule: {
    ingest_minutes: 5,
    daily_hour: 18,
  },
  storage: {
    base_dir: "~/.amber",
  },
  processing: {
    provider: "claude",
    model: "claude-sonnet-4-5-20250929",
    codex_command: "codex",
    codex_args: ["--headless", "--model", "{model}", "-p", "{prompt}"],
  },
};

export default function Settings() {
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

  const updateSchedule = (partial: Partial<AmberConfig["schedule"]>) =>
    setConfig((c) => ({ ...c, schedule: { ...c.schedule, ...partial } }));

  const updateStorage = (partial: Partial<AmberConfig["storage"]>) =>
    setConfig((c) => ({ ...c, storage: { ...c.storage, ...partial } }));

  const updateProcessing = (
    partial: Partial<NonNullable<AmberConfig["processing"]>>,
  ) =>
    setConfig((c) => ({
      ...c,
      processing: (() => {
        const previousProvider = c.processing?.provider;
        const previousModel = c.processing?.model;
        const nextProcessing = {
          ...c.processing,
          ...partial,
        };

        if (
          partial.provider === "codex" &&
          previousProvider !== "codex" &&
          previousModel === defaultConfig.processing.model
        ) {
          return { ...nextProcessing, model: "spark" };
        }

        return nextProcessing;
      })(),
    }));

  return (
    <div className="settings">
      <div className="view-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-body">
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

        {/* Processing */}
        <div className="section">
          <div className="section-title">Processing Engine</div>
          <div className="field">
            <label>Provider</label>
            <select
              value={config.processing?.provider || "claude"}
              onChange={(e) =>
                updateProcessing({
                  provider: e.target.value as "claude" | "codex",
                })
              }
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </div>

          <div className="field">
            <label>Model</label>
            <input
              type="text"
              value={config.processing?.model || ""}
              onChange={(e) =>
                updateProcessing({ model: e.target.value || defaultConfig.processing!.model })
              }
              placeholder="e.g. claude-sonnet-4-5-20250929 or spark"
            />
          </div>

          {(config.processing?.provider || "claude") === "codex" && (
            <>
              <div className="field">
                <label>Codex Command</label>
                <input
                  type="text"
                  value={config.processing?.codex_command || "codex"}
                  onChange={(e) =>
                    updateProcessing({ codex_command: e.target.value })
                  }
                  placeholder="e.g. codex"
                />
              </div>

              <div className="field">
                <label>Codex Arguments</label>
                <textarea
                  rows={4}
                  value={(config.processing?.codex_args ?? []).join("\n")}
                  onChange={(e) =>
                    updateProcessing({
                      codex_args: e.target.value.split("\n").filter((a) => a.trim().length > 0),
                    })
                  }
                  placeholder="Each arg on its own line. Use {model}, {prompt}, {mcpConfig} placeholders."
                />
              </div>
            </>
          )}
        </div>

        {/* Sources */}
        <div className="section">
          <div className="section-title">Sources</div>
          <Sources />
        </div>

        {/* Connections */}
        <div className="section">
          <div className="section-title">Connections</div>
          <Clients />
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
