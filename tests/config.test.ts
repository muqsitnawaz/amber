import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

let tmpDir: string;
let originalHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "amber-config-test-"));
  originalHome = process.env.HOME!;
  // Override homedir so config.ts uses our temp directory
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
  // Reset module cache to pick up new HOME
  vi.resetModules();
});

describe("config", () => {
  it("creates default config when none exists", async () => {
    const { loadOrDefault } = await import("../electron/config");
    const config = await loadOrDefault();

    expect(config.schedule.daily_hour).toBe(18);
    expect(config.storage.base_dir).toBe("~/.amber");
    expect(config.processing?.provider).toBe("claude");
    expect(config.processing?.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.processing?.codex_command).toBe("codex");
    expect(config.processing?.codex_args?.[0]).toBe("--headless");

    // Should have created the file
    const configPath = path.join(tmpDir, ".amber", "config.yaml");
    const exists = await fs.access(configPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("round-trips save and load", async () => {
    const { loadOrDefault, save } = await import("../electron/config");
    const config = await loadOrDefault();

    config.schedule.daily_hour = 22;
    config.agent_sessions = { claude_code: true, clawdbot: true };
    config.processing = {
      ...config.processing,
      provider: "codex",
      model: "spark",
      codex_command: "codex-test",
      codex_args: ["--headless", "--model", "{model}"],
    };

    await save(config);
    const loaded = await loadOrDefault();

    expect(loaded.schedule.daily_hour).toBe(22);
    expect(loaded.agent_sessions?.clawdbot).toBe(true);
    expect(loaded.processing?.provider).toBe("codex");
    expect(loaded.processing?.model).toBe("spark");
    expect(loaded.processing?.codex_command).toBe("codex-test");
  });

  it("merges partial config with defaults", async () => {
    // Write a partial config that only has some fields
    const configDir = path.join(tmpDir, ".amber");
    await fs.mkdir(configDir, { recursive: true });

    const partial = {
      schedule: { ingest_minutes: 10, daily_hour: 20 },
    };
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      yaml.dump(partial),
    );

    const { loadOrDefault } = await import("../electron/config");
    const config = await loadOrDefault();

    // Overridden values
    expect(config.schedule.daily_hour).toBe(20);
    expect(config.schedule.ingest_minutes).toBe(10);
    // Default values still present
    expect(config.storage.base_dir).toBe("~/.amber");
  });

  it("writes valid YAML", async () => {
    const { loadOrDefault, save } = await import("../electron/config");
    const config = await loadOrDefault();
    await save(config);

    const raw = await fs.readFile(
      path.join(tmpDir, ".amber", "config.yaml"),
      "utf-8",
    );
    const parsed = yaml.load(raw) as Record<string, unknown>;

    expect(parsed).toHaveProperty("schedule");
    expect(parsed).toHaveProperty("storage");
  });
});
