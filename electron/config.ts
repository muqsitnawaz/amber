import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { AmberConfig } from "./types";

const defaultConfig: AmberConfig = {
  schedule: {
    ingest_minutes: 5,
    daily_hour: 18,
  },
  storage: {
    base_dir: "~/.amber",
  },
  agent_sessions: {
    claude_code: true,
    clawdbot: false,
    codex: true,
    opencode: true,
    custom_paths: [],
  },
  obsidian: {
    enabled: false,
    vault_paths: [],
  },
  notion: {
    enabled: false,
    api_key: "",
  },
  email: {
    enabled: false,
  },
  mcp_server: {
    enabled: true,
  },
  processing: {
    provider: "claude",
    model: "claude-sonnet-4-5-20250929",
    codex_command: "codex",
    codex_args: ["--headless", "--model", "{model}", "-p", "{prompt}"],
  },
};

function configPath(): string {
  return path.join(os.homedir(), ".amber", "config.yaml");
}

export async function loadOrDefault(): Promise<AmberConfig> {
  const cfgPath = configPath();
  try {
    const raw = await fs.readFile(cfgPath, "utf-8");
    const parsed = yaml.load(raw) as Partial<AmberConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      schedule: { ...defaultConfig.schedule, ...parsed.schedule },
      storage: { ...defaultConfig.storage, ...parsed.storage },
      agent_sessions: { ...defaultConfig.agent_sessions, ...parsed.agent_sessions },
      obsidian: { ...defaultConfig.obsidian, ...parsed.obsidian },
      notion: { ...defaultConfig.notion, ...parsed.notion },
      email: { ...defaultConfig.email, ...parsed.email },
      mcp_server: { ...defaultConfig.mcp_server, ...parsed.mcp_server },
      processing: { ...defaultConfig.processing, ...parsed.processing },
    };
  } catch {
    await save(defaultConfig);
    return defaultConfig;
  }
}

export async function save(config: AmberConfig): Promise<void> {
  const cfgPath = configPath();
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(cfgPath, yaml.dump(config, { lineWidth: -1 }), "utf-8");
}
