import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { listWikiPages } from "./wiki";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const CODEX_DIR = path.join(os.homedir(), ".codex");
const OPENCODE_DIR = path.join(os.homedir(), ".config", "opencode");

export interface SessionInfo {
  source: "claude" | "codex" | "opencode";
  projectPath: string;
  sessionPath: string;
  modifiedAt: Date;
}

export async function isFirstLaunch(baseDir?: string): Promise<boolean> {
  const pages = await listWikiPages(undefined, baseDir);
  return pages.length === 0;
}

export async function scanAllSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];

  // Scan Claude projects
  try {
    const claudeSessions = await scanClaudeSessions();
    sessions.push(...claudeSessions);
  } catch {
    // Directory may not exist
  }

  // Scan Codex sessions
  try {
    const codexSessions = await scanCodexSessions();
    sessions.push(...codexSessions);
  } catch {
    // Directory may not exist
  }

  // Scan OpenCode sessions
  try {
    const opencodeSessions = await scanOpenCodeSessions();
    sessions.push(...opencodeSessions);
  } catch {
    // Directory may not exist
  }

  // Sort by modification date (newest first)
  sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return sessions;
}

async function scanClaudeSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];

  try {
    const projects = await fs.readdir(CLAUDE_PROJECTS_DIR);

    for (const project of projects) {
      const projectPath = path.join(CLAUDE_PROJECTS_DIR, project);
      const stat = await fs.stat(projectPath);

      if (!stat.isDirectory()) continue;

      // Look for session files in the project directory
      const files = await fs.readdir(projectPath);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          const sessionPath = path.join(projectPath, file);
          const sessionStat = await fs.stat(sessionPath);
          sessions.push({
            source: "claude",
            projectPath,
            sessionPath,
            modifiedAt: sessionStat.mtime,
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }

  return sessions;
}

async function scanCodexSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];

  try {
    const entries = await fs.readdir(CODEX_DIR);

    for (const entry of entries) {
      const entryPath = path.join(CODEX_DIR, entry);
      const stat = await fs.stat(entryPath);

      if (stat.isDirectory()) {
        // Look for session files
        try {
          const files = await fs.readdir(entryPath);
          for (const file of files) {
            if (file.endsWith(".jsonl") || file.endsWith(".json")) {
              const sessionPath = path.join(entryPath, file);
              const sessionStat = await fs.stat(sessionPath);
              sessions.push({
                source: "codex",
                projectPath: entryPath,
                sessionPath,
                modifiedAt: sessionStat.mtime,
              });
            }
          }
        } catch {
          // Subdirectory not accessible
        }
      } else if (entry.endsWith(".jsonl") || entry.endsWith(".json")) {
        sessions.push({
          source: "codex",
          projectPath: CODEX_DIR,
          sessionPath: entryPath,
          modifiedAt: stat.mtime,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return sessions;
}

async function scanOpenCodeSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];

  try {
    const entries = await fs.readdir(OPENCODE_DIR);

    for (const entry of entries) {
      const entryPath = path.join(OPENCODE_DIR, entry);
      const stat = await fs.stat(entryPath);

      if (stat.isDirectory()) {
        try {
          const files = await fs.readdir(entryPath);
          for (const file of files) {
            if (file.endsWith(".jsonl") || file.endsWith(".json")) {
              const sessionPath = path.join(entryPath, file);
              const sessionStat = await fs.stat(sessionPath);
              sessions.push({
                source: "opencode",
                projectPath: entryPath,
                sessionPath,
                modifiedAt: sessionStat.mtime,
              });
            }
          }
        } catch {
          // Subdirectory not accessible
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return sessions;
}

export async function extractProjectName(sessionPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionPath, "utf-8");
    const lines = content.split("\n").filter(Boolean).slice(0, 50); // First 50 lines

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        // Look for cwd or project references
        if (event.cwd) {
          return path.basename(event.cwd);
        }
        if (event.payload?.cwd) {
          return path.basename(event.payload.cwd);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File not readable
  }

  // Fall back to directory name
  return path.basename(path.dirname(sessionPath));
}
