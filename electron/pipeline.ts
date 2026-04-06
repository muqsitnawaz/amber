/**
 * OpenWiki Pipeline
 *
 * Full flow: scan sessions → extract entities → create wiki pages
 *
 * Design principles:
 * - Works without LLM (extraction is pattern-based)
 * - LLM compilation is optional enhancement
 * - Robust to partial failures
 * - Incremental (can resume from any point)
 */

import { scanAgentSources, listAgentSessionPreviews, extractSessionSummary, type AgentSource, type SessionPreview } from "./import";
import { extractFromSessions, type ExtractedEntity } from "./extractor";
import { listWikiPages, upsertWikiPage, createWikiPage, type WikiPage } from "./wiki";
import { resolveBaseDir } from "./storage";
import * as fs from "fs/promises";
import * as path from "path";

export interface PipelineProgress {
  stage: "scanning" | "extracting" | "creating" | "compiling" | "done" | "error";
  current: number;
  total: number;
  message: string;
}

export interface PipelineResult {
  sessionsScanned: number;
  entitiesExtracted: number;
  pagesCreated: number;
  pagesUpdated: number;
  errors: string[];
}

export type ProgressCallback = (progress: PipelineProgress) => void;

/**
 * Run the full pipeline: scan → extract → create wiki pages
 * Does NOT require LLM - creates pages from raw extraction data
 */
export async function runPipeline(
  options: {
    cutoffDays?: number;
    agents?: string[];
    onProgress?: ProgressCallback;
    baseDir?: string;
  } = {}
): Promise<PipelineResult> {
  const { cutoffDays = 30, agents, onProgress, baseDir } = options;
  const result: PipelineResult = {
    sessionsScanned: 0,
    entitiesExtracted: 0,
    pagesCreated: 0,
    pagesUpdated: 0,
    errors: [],
  };

  const report = (stage: PipelineProgress["stage"], current: number, total: number, message: string) => {
    onProgress?.({ stage, current, total, message });
  };

  try {
    // Stage 1: Scan for available agent sources
    report("scanning", 0, 1, "Scanning for agent sessions...");
    const sources = await scanAgentSources(cutoffDays);
    const activeSources = sources.filter(s => {
      if (!s.found || s.sessionCount === 0) return false;
      if (agents && !agents.includes(s.id)) return false;
      return true;
    });

    if (activeSources.length === 0) {
      report("done", 0, 0, "No sessions found to process");
      return result;
    }

    // Stage 2: Collect session summaries
    report("extracting", 0, activeSources.length, "Extracting session data...");
    const sessionData: Array<{ id: string; timestamp: string; summary: string }> = [];

    for (let i = 0; i < activeSources.length; i++) {
      const source = activeSources[i];
      report("extracting", i, activeSources.length, `Processing ${source.name}...`);

      try {
        const previews = await listAgentSessionPreviews(source.id, cutoffDays);

        for (const preview of previews.slice(0, 50)) { // Cap at 50 per agent
          try {
            const summary = await extractSessionSummary(preview.id);
            if (summary && summary !== "Empty or unreadable session." && summary !== "Could not read session file.") {
              sessionData.push({
                id: preview.id,
                timestamp: preview.date,
                summary,
              });
              result.sessionsScanned++;
            }
          } catch (err) {
            result.errors.push(`Failed to read session ${preview.id}: ${err}`);
          }
        }
      } catch (err) {
        result.errors.push(`Failed to scan ${source.name}: ${err}`);
      }
    }

    if (sessionData.length === 0) {
      report("done", 0, 0, "No readable sessions found");
      return result;
    }

    // Stage 3: Extract entities
    report("extracting", activeSources.length, activeSources.length, "Extracting entities...");
    const entityMap = extractFromSessions(sessionData);
    result.entitiesExtracted = entityMap.size;

    if (entityMap.size === 0) {
      report("done", result.sessionsScanned, result.sessionsScanned, "No entities extracted");
      return result;
    }

    // Stage 4: Create/update wiki pages
    report("creating", 0, entityMap.size, "Creating wiki pages...");
    const existingPages = await listWikiPages(undefined, baseDir);
    const existingBySlug = new Map(existingPages.map(p => [p.id, p]));

    let pageIndex = 0;
    for (const [key, data] of entityMap) {
      report("creating", pageIndex, entityMap.size, `Creating page: ${data.entity.name}`);

      try {
        const slug = slugify(data.entity.name);
        const existing = existingBySlug.get(slug);

        if (existing) {
          // Update existing page with new mentions
          const updatedPage = mergeWikiPage(existing, data.entity, data.mentions);
          await upsertWikiPage(updatedPage, baseDir);
          result.pagesUpdated++;
        } else {
          // Create new page
          const newPage = createWikiPageFromEntity(data.entity, data.mentions);
          await upsertWikiPage(newPage, baseDir);
          result.pagesCreated++;
        }
      } catch (err) {
        result.errors.push(`Failed to create page for ${data.entity.name}: ${err}`);
      }

      pageIndex++;
    }

    report("done", entityMap.size, entityMap.size,
      `Created ${result.pagesCreated} pages, updated ${result.pagesUpdated}`);

  } catch (err) {
    report("error", 0, 0, `Pipeline failed: ${err}`);
    result.errors.push(`Pipeline error: ${err}`);
  }

  return result;
}

/**
 * Create a wiki page from extracted entity data
 * No LLM needed - creates structured content from raw data
 */
function createWikiPageFromEntity(
  entity: ExtractedEntity,
  mentions: Array<{ sessionId: string; context: string; timestamp: string }>
): WikiPage {
  const now = new Date().toISOString();

  // Build content from mentions
  const contentParts: string[] = [];
  contentParts.push(`# ${entity.name}\n`);
  contentParts.push(`*${entity.type.charAt(0).toUpperCase() + entity.type.slice(1)} extracted from ${mentions.length} session(s)*\n`);

  // Key mentions section
  contentParts.push(`\n## Mentions\n`);
  const uniqueContexts = [...new Set(mentions.map(m => m.context))].slice(0, 10);
  for (const ctx of uniqueContexts) {
    contentParts.push(`- ${ctx.replace(/\n/g, " ").slice(0, 150)}`);
  }

  // Timeline
  contentParts.push(`\n## Timeline\n`);
  const sortedMentions = [...mentions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const firstSeen = sortedMentions[0]?.timestamp || now;
  const lastSeen = sortedMentions[sortedMentions.length - 1]?.timestamp || now;
  contentParts.push(`- First seen: ${firstSeen.slice(0, 10)}`);
  contentParts.push(`- Last seen: ${lastSeen.slice(0, 10)}`);
  contentParts.push(`- Total mentions: ${mentions.length}`);

  return {
    id: slugify(entity.name),
    title: entity.name,
    type: entity.type,
    content: contentParts.join("\n"),
    sources: [...new Set(mentions.map(m => m.sessionId))],
    related: [], // Will be populated by compiler if LLM is available
    created_at: now,
    updated_at: now,
  };
}

/**
 * Merge new mentions into an existing wiki page
 */
function mergeWikiPage(
  existing: WikiPage,
  entity: ExtractedEntity,
  newMentions: Array<{ sessionId: string; context: string; timestamp: string }>
): WikiPage {
  const now = new Date().toISOString();

  // Add new sources
  const allSources = [...new Set([...existing.sources, ...newMentions.map(m => m.sessionId)])];

  // Append new contexts to mentions section
  let content = existing.content;
  const newContexts = newMentions
    .filter(m => !existing.sources.includes(m.sessionId))
    .map(m => m.context)
    .slice(0, 5);

  if (newContexts.length > 0) {
    // Find mentions section and append
    const mentionsIdx = content.indexOf("## Mentions");
    if (mentionsIdx !== -1) {
      const nextSectionIdx = content.indexOf("\n## ", mentionsIdx + 10);
      const insertPoint = nextSectionIdx !== -1 ? nextSectionIdx : content.length;
      const newLines = newContexts.map(ctx => `- ${ctx.replace(/\n/g, " ").slice(0, 150)}`).join("\n");
      content = content.slice(0, insertPoint) + "\n" + newLines + content.slice(insertPoint);
    }

    // Update timeline
    const allMentions = [...newMentions];
    const sortedMentions = allMentions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const lastSeen = sortedMentions[sortedMentions.length - 1]?.timestamp || now;
    content = content.replace(/- Last seen: \d{4}-\d{2}-\d{2}/, `- Last seen: ${lastSeen.slice(0, 10)}`);
    content = content.replace(/- Total mentions: \d+/, `- Total mentions: ${allSources.length}`);
  }

  return {
    ...existing,
    content,
    sources: allSources,
    updated_at: now,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Check if this is the first launch (no wiki pages exist)
 */
export async function isFirstLaunch(baseDir?: string): Promise<boolean> {
  const pages = await listWikiPages(undefined, baseDir);
  return pages.length === 0;
}

/**
 * Get a summary of available session sources
 */
export async function getSourcesSummary(cutoffDays = 30): Promise<{
  sources: AgentSource[];
  totalSessions: number;
  hasData: boolean;
}> {
  const sources = await scanAgentSources(cutoffDays);
  const totalSessions = sources.reduce((sum, s) => sum + s.sessionCount, 0);
  return {
    sources,
    totalSessions,
    hasData: totalSessions > 0,
  };
}
