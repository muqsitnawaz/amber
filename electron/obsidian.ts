import * as fs from "fs/promises";
import * as path from "path";
import { ContextEntry } from "./types";

/**
 * Read recently modified Obsidian notes from a vault.
 * Returns context entries for notes modified within the specified hours.
 */
export async function readObsidianNotes(
  vaultPath: string,
  hoursBack: number = 24,
  limit: number = 30,
): Promise<ContextEntry[]> {
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const entries: ContextEntry[] = [];

  try {
    await collectNotes(vaultPath, vaultPath, cutoff, entries, 0, 4);
  } catch {
    return [];
  }

  // Sort by modification time descending
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(0, limit);
}

async function collectNotes(
  vaultRoot: string,
  dir: string,
  cutoff: number,
  entries: ContextEntry[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth) return;

  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    // Skip hidden directories and Obsidian config
    if (item.name.startsWith(".")) continue;
    // Skip common non-note directories
    if (item.name === "node_modules" || item.name === ".trash") continue;

    if (item.isDirectory()) {
      await collectNotes(vaultRoot, fullPath, cutoff, entries, depth + 1, maxDepth);
    } else if (item.name.endsWith(".md")) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs > cutoff) {
          const relativePath = path.relative(vaultRoot, fullPath);
          const title = item.name.replace(/\.md$/, "");
          const content = await fs.readFile(fullPath, "utf-8");
          const excerpt = extractExcerpt(content);

          entries.push({
            id: `obsidian-${Buffer.from(fullPath).toString("base64").slice(0, 16)}`,
            source: "obsidian",
            timestamp: new Date(stat.mtimeMs).toISOString(),
            kind: "note",
            title,
            detail: excerpt,
            projectPath: vaultRoot,
            data: {
              relative_path: relativePath,
              vault: path.basename(vaultRoot),
              word_count: content.split(/\s+/).length,
            },
          });
        }
      } catch {
        continue;
      }
    }
  }
}

function extractExcerpt(content: string): string {
  // Strip frontmatter
  let text = content;
  const fmMatch = text.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmMatch) text = text.slice(fmMatch[0].length);

  // Strip headings markers, links, etc. for clean excerpt
  text = text
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();

  // Take first ~150 chars
  if (text.length > 150) {
    return text.slice(0, 147) + "...";
  }
  return text || "(empty note)";
}
