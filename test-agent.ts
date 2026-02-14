/**
 * Quick end-to-end test of the processing agent via claude CLI.
 * Run: npx tsx test-agent.ts
 * No API key needed — uses your claude subscription auth.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import { loadOrDefault } from "./electron/config";
import { readDailyNote, readAllEntities, resolveBaseDir } from "./electron/storage";

const exec = promisify(execFile);

async function main() {
  const config = await loadOrDefault();
  const date = new Date().toISOString().slice(0, 10);
  const baseDir = resolveBaseDir(config.storage.base_dir);

  console.log(`\n=== Testing processDay for ${date} ===`);
  console.log(`Model: ${config.summarizer.model}`);
  console.log(`Base dir: ${baseDir}\n`);

  // Point to the source .ts file for tsx, or built .js for production
  const mcpServerPath = path.join(__dirname, "electron", "summarizer", "processing-mcp.ts");
  const mcpConfig = JSON.stringify({
    mcpServers: {
      "amber-processing": {
        command: "npx",
        args: ["tsx", mcpServerPath],
        env: { AMBER_BASE_DIR: baseDir },
      },
    },
  });

  const prompt = `Process events for ${date}.

Amber base directory: ${baseDir}
Staging events: ${path.join(baseDir, "staging", `${date}.jsonl`)}
Daily notes dir: ${path.join(baseDir, "daily")}

Read the staging file, then call write_daily_note and upsert_knowledge for all entities found.`;

  console.log("Starting agent via claude CLI...\n");
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await exec("claude", [
      "-p", prompt,
      "--system-prompt", "You are Amber's processing agent. Read the staging JSONL, extract entities via upsert_knowledge, and write a daily note via write_daily_note. Be concise.",
      "--mcp-config", mcpConfig,
      "--permission-mode", "bypassPermissions",
      "--model", config.summarizer.model,
      "--allowed-tools", "Bash", "Read", "Glob", "Grep",
        "mcp__amber-processing__write_daily_note",
        "mcp__amber-processing__upsert_knowledge",
        "mcp__amber-processing__read_knowledge",
      "--output-format", "text",
      "--max-budget-usd", "0.50",
      "--no-session-persistence",
    ], {
      cwd: os.homedir(),
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    if (stderr) console.error("stderr:", stderr.slice(0, 500));
    console.log("Agent output:", stdout.slice(0, 1000));
  } catch (err: any) {
    console.error(`\nAgent error: ${err.message}`);
    if (err.stderr) console.error("stderr:", err.stderr.slice(0, 500));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Finished in ${elapsed}s ===\n`);

  // Check outputs
  const note = await readDailyNote(date, config.storage.base_dir);
  if (note) {
    console.log("--- Daily Note ---");
    console.log(note.slice(0, 1500));
    console.log("--- End Note ---\n");
  } else {
    console.log("WARNING: No daily note was written!\n");
  }

  const entities = await readAllEntities(config.storage.base_dir);
  console.log(`Knowledge entities: ${entities.length}`);
  for (const e of entities.slice(0, 10)) {
    console.log(`  [${e.type}] ${e.name} (${e.mention_count}x)`);
  }
}

main();
