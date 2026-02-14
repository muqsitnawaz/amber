import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AmberConfig } from "../types";
import { resolveBaseDir } from "../storage";

const exec = promisify(execFile);
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_CODEX_MODEL = "spark";
const DEFAULT_CODEX_ARGS = ["--headless", "--model", "{model}", "-p", "{prompt}"];

const SYSTEM_PROMPT = `You are Amber's processing agent. You process a developer's daily context and produce two outputs:

1. A daily reference note (markdown with YAML frontmatter)
2. Knowledge graph entities (projects, people, topics)

DAILY NOTE FORMAT:
- YAML frontmatter with: date, projects (list of filesystem paths), topics (list), people (list)
- Section headings (only include sections that have content):
  - Projects Touched: list of {path, branch, brief note}
  - Key Commits: important commits with 8-char hash and one-liner
  - Agent Sessions: what AI agents were used for
  - Research: topics researched (from browser/chat history)
  - Decisions: any notable technical decisions
  - People: collaborators mentioned
- Be extremely concise — this is a reference card, not a report
- Always include filesystem paths for projects
- Commit hashes should be abbreviated (8 chars)
- No fluff, no filler, no "today I worked on..."

KNOWLEDGE ENTITIES:
Extract every distinct project, person, and topic you encounter.
Use read_knowledge first to check existing entity names and maintain consistency.
Then call upsert_knowledge for each entity.

Entity types and metadata:
- project: { paths: ["/abs/path"], repo_names: ["name"], branches: ["main"] }
- person: { aliases: [], associated_projects: ["project:slug"] }
- topic: { keywords: [], associated_projects: ["project:slug"] }

TOOLS AVAILABLE:
- Built-in: Read files, run shell commands (Bash), search files (Glob/Grep)
- Custom: write_daily_note, upsert_knowledge, read_knowledge
- CLI: \`mq\` for querying markdown/JSONL files:
  - Browse structure: mq <path> '.tree("full")'
  - Search content: mq <path> '.search("term")'

PROCESS:
1. Read the staging events JSONL file for today
2. If agent sessions exist, read the recent session files for context
3. Call read_knowledge to see existing entities for naming consistency
4. Call upsert_knowledge for each entity you identify
5. Call write_daily_note with the final markdown
6. Output a brief summary of what you processed`;

export async function processDay(date: string, config: AmberConfig): Promise<void> {
  const baseDir = resolveBaseDir(config.storage.base_dir);
  const processing = config.processing ?? {};
  const provider = processing.provider ?? "claude";
  const model = processing.model
    ?? (provider === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL);

  // Resolve MCP server path: use built .js if available, fall back to .ts with tsx for dev
  const builtPath = path.join(__dirname, "processing-mcp.js");
  const isDev = !fs.existsSync(builtPath);
  const mcpServerPath = isDev
    ? path.resolve(__dirname, "processing-mcp.ts")
    : builtPath;
  const mcpCommand = isDev ? "npx" : "node";
  const mcpArgs = isDev ? ["tsx", mcpServerPath] : [mcpServerPath];

  const mcpConfig = JSON.stringify({
    mcpServers: {
      "amber-processing": {
        command: mcpCommand,
        args: mcpArgs,
        env: { AMBER_BASE_DIR: baseDir },
      },
    },
  });

  const agentSessions = config.agent_sessions ?? {};
  const sessionInfo: string[] = [];
  if (agentSessions.claude_code) sessionInfo.push("Claude Code sessions: ~/.claude/projects/");
  if (agentSessions.clawdbot) sessionInfo.push("Clawdbot sessions: ~/.clawdbot/sessions/");
  if (agentSessions.codex) sessionInfo.push("Codex sessions: ~/.codex/sessions/");
  if (agentSessions.opencode) sessionInfo.push("OpenCode sessions: ~/.opencode/sessions/");

  let prompt = `Process events for ${date}.\n\n`;
  prompt += `Amber base directory: ${baseDir}\n`;
  prompt += `Staging events: ${path.join(baseDir, "staging", `${date}.jsonl`)}\n`;
  prompt += `Daily notes dir: ${path.join(baseDir, "daily")}\n`;
  if (sessionInfo.length > 0) {
    prompt += `\nAgent sessions available:\n${sessionInfo.map(s => `- ${s}`).join("\n")}\n`;
    prompt += `Read the most recent session files (last 48 hours) for context.\n`;
  }
  prompt += `\nAfter processing, call write_daily_note with the complete note and upsert_knowledge for all entities found.`;

  const combinedPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;

  const { command, args } = resolveProcessorInvocation({
    provider,
    model,
    prompt: combinedPrompt,
    mcpConfig,
    codexCommand: processing.codex_command ?? "codex",
    codexArgs: processing.codex_args ?? DEFAULT_CODEX_ARGS,
  });

  const { stdout } = await exec(command, args, {
    cwd: os.homedir(),
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  console.log(`Processing agent completed for ${date}`);
  if (stdout) console.log(stdout.slice(0, 500));
}

type ProcessorInvocation = {
  command: string;
  args: string[];
};

export function resolveProcessorInvocation({
  provider,
  model,
  prompt,
  mcpConfig,
  codexCommand,
  codexArgs,
}: {
  provider: "claude" | "codex";
  model: string;
  prompt: string;
  mcpConfig: string;
  codexCommand: string;
  codexArgs: string[];
}): ProcessorInvocation {
  if (provider === "claude") {
  return {
    command: "claude",
    args: [
        "-p", prompt,
        "--system-prompt", SYSTEM_PROMPT,
        "--mcp-config", mcpConfig,
        "--permission-mode", "bypassPermissions",
        "--model", model,
        "--allowed-tools", "Bash", "Read", "Glob", "Grep",
        "mcp__amber-processing__write_daily_note",
        "mcp__amber-processing__upsert_knowledge",
        "mcp__amber-processing__read_knowledge",
        "--output-format", "text",
        "--max-budget-usd", "0.50",
        "--no-session-persistence",
      ],
    };
  }

  const preparedTemplate = codexArgs.length > 0 ? codexArgs : DEFAULT_CODEX_ARGS;
  const preparedArgs = preparedTemplate.map((arg) =>
    arg
      .replaceAll("{prompt}", prompt)
      .replaceAll("{model}", model)
      .replaceAll("{mcpConfig}", mcpConfig),
  );

  return {
    command: codexCommand,
    args: preparedArgs,
  };
}
