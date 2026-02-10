import { invoke } from "@tauri-apps/api/core";

export interface AmberConfig {
  sources: {
    git: {
      watch_paths: string[];
      scan_depth: number;
      enabled: boolean;
    };
  };
  summarizer: {
    provider: string;
    model: string;
    api_base: string;
    api_key_env: string;
  };
  schedule: {
    ingest_minutes: number;
    daily_hour: number;
  };
  storage: {
    base_dir: string;
  };
}

export interface AppStatus {
  watchers_running: boolean;
  buffered_events: number;
  last_summarized: string | null;
}

export function getConfig(): Promise<AmberConfig> {
  return invoke("get_config");
}

export function updateConfig(config: AmberConfig): Promise<void> {
  return invoke("update_config", { config });
}

export function getDailyNote(date: string): Promise<string | null> {
  return invoke("get_daily_note", { date });
}

export function getStatus(): Promise<AppStatus> {
  return invoke("get_status");
}

export function triggerSummarize(): Promise<void> {
  return invoke("trigger_summarize");
}
