import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DetectedSource, AmberConfig } from "./types";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findObsidianVaults(): Promise<string[]> {
  const home = os.homedir();
  const searchDirs = [
    home,
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    // iCloud Obsidian sync location
    path.join(home, "Library/Mobile Documents/iCloud~md~obsidian/Documents"),
  ];

  const vaults: string[] = [];

  for (const dir of searchDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const obsidianDir = path.join(dir, entry.name, ".obsidian");
          if (await exists(obsidianDir)) {
            vaults.push(path.join(dir, entry.name));
          }
        }
      }
    } catch {
      continue;
    }
  }

  return vaults;
}

export async function detectSources(config: AmberConfig): Promise<DetectedSource[]> {
  const home = os.homedir();
  const sessions = config.agent_sessions ?? {};
  const browser = config.browser_history ?? {};

  const sources: DetectedSource[] = [];

  // ── Agents ──

  // Claude Code
  const claudeDir = path.join(home, ".claude", "projects");
  sources.push({
    id: "claude_code",
    name: "Claude Code",
    type: "agent",
    detected: await exists(claudeDir),
    enabled: sessions.claude_code ?? true,
    path: claudeDir,
    description: "Claude Code CLI sessions and transcripts",
  });

  // Clawdbot
  const clawdbotDir = path.join(home, ".clawdbot");
  sources.push({
    id: "clawdbot",
    name: "Clawdbot",
    type: "agent",
    detected: await exists(clawdbotDir),
    enabled: sessions.clawdbot ?? false,
    path: clawdbotDir,
    description: "Clawdbot agent sessions",
  });

  // Codex (OpenAI)
  const codexDir = path.join(home, ".codex");
  sources.push({
    id: "codex",
    name: "Codex",
    type: "agent",
    detected: await exists(codexDir),
    enabled: sessions.codex ?? true,
    path: codexDir,
    description: "OpenAI Codex CLI agent sessions",
  });

  // OpenCode
  const opencodeConfig = path.join(home, ".config", "opencode");
  sources.push({
    id: "opencode",
    name: "OpenCode",
    type: "agent",
    detected: await exists(opencodeConfig),
    enabled: sessions.opencode ?? true,
    path: opencodeConfig,
    description: "OpenCode agent sessions",
  });

  // ── Browsers ──

  // Chrome
  const chromeHistory = path.join(
    home,
    "Library/Application Support/Google/Chrome/Default/History",
  );
  sources.push({
    id: "chrome",
    name: "Chrome",
    type: "browser",
    detected: await exists(chromeHistory),
    enabled: browser.chrome ?? false,
    path: chromeHistory,
    description: "Google Chrome browsing history",
  });

  // Safari
  const safariHistory = path.join(home, "Library/Safari/History.db");
  sources.push({
    id: "safari",
    name: "Safari",
    type: "browser",
    detected: await exists(safariHistory),
    enabled: browser.safari ?? false,
    path: safariHistory,
    description: "Safari browsing history",
  });

  // ── Knowledge ──

  // Obsidian
  const obsidianVaults = await findObsidianVaults();
  const obsidianCfg = config.obsidian ?? {};
  const allVaults = [...new Set([...obsidianVaults, ...(obsidianCfg.vault_paths ?? [])])];
  sources.push({
    id: "obsidian",
    name: "Obsidian",
    type: "knowledge",
    detected: allVaults.length > 0,
    enabled: obsidianCfg.enabled ?? false,
    path: allVaults[0],
    description: allVaults.length > 0
      ? `${allVaults.length} vault${allVaults.length > 1 ? "s" : ""} found`
      : "No vaults detected",
  });

  // Notion
  const notionCfg = config.notion ?? {};
  sources.push({
    id: "notion",
    name: "Notion",
    type: "knowledge",
    detected: await exists("/Applications/Notion.app") || !!notionCfg.api_key,
    enabled: notionCfg.enabled ?? false,
    description: notionCfg.api_key
      ? "Connected via API"
      : "Add API key in settings to connect",
  });

  // ── Chat Apps ──

  // ChatGPT Desktop
  sources.push({
    id: "chatgpt",
    name: "ChatGPT",
    type: "chat",
    detected: await exists("/Applications/ChatGPT.app"),
    enabled: false,
    description: "ChatGPT desktop app conversations (coming soon)",
  });

  // Claude Desktop
  sources.push({
    id: "claude_desktop",
    name: "Claude",
    type: "chat",
    detected: await exists("/Applications/Claude.app"),
    enabled: false,
    description: "Claude desktop app conversations (coming soon)",
  });

  // Perplexity
  sources.push({
    id: "perplexity",
    name: "Perplexity",
    type: "chat",
    detected: await exists("/Applications/Perplexity.app"),
    enabled: false,
    description: "Perplexity AI conversations (coming soon)",
  });

  // ── Email ──

  const mailDir = path.join(home, "Library/Mail");
  sources.push({
    id: "apple_mail",
    name: "Apple Mail",
    type: "email",
    detected: await exists(mailDir),
    enabled: config.email?.enabled ?? false,
    path: mailDir,
    description: "macOS Mail app (coming soon)",
  });

  sources.push({
    id: "outlook",
    name: "Outlook",
    type: "email",
    detected: await exists("/Applications/Microsoft Outlook.app"),
    enabled: false,
    description: "Microsoft Outlook (coming soon)",
  });

  return sources;
}
