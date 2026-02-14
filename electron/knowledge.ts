import * as path from "path";
import * as yaml from "js-yaml";
import { KnowledgeEntity, EntityType, AgentUpsertInput } from "./types";
import { upsertEntity, readAllEntities, readDailyNote, listDailyNotes } from "./storage";

export function buildSlug(type: EntityType, name: string): string {
  return `${type}:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

function makeEntity(
  type: EntityType,
  name: string,
  date: string,
  source: string,
  metadata: Record<string, unknown> = {},
): KnowledgeEntity {
  return {
    id: crypto.randomUUID(),
    type,
    slug: buildSlug(type, name),
    name,
    first_seen: date,
    last_seen: date,
    mention_count: 1,
    sources: [source],
    metadata,
  };
}

/** Called by the processing agent's upsert_knowledge tool */
export async function upsertFromAgentCall(input: AgentUpsertInput, baseDir?: string): Promise<void> {
  const entity = makeEntity(input.type, input.name, input.date, input.source, input.metadata ?? {});
  await upsertEntity(entity, baseDir);
}

export async function ingestEntities(entities: KnowledgeEntity[], baseDir?: string): Promise<void> {
  for (const entity of entities) {
    await upsertEntity(entity, baseDir);
  }
}

export async function backfillFromDailyNotes(baseDir?: string): Promise<{ processed: number; entities: number }> {
  const dates = await listDailyNotes(baseDir);
  let processed = 0;
  const beforeCount = (await readAllEntities(baseDir)).length;

  for (const date of dates) {
    const content = await readDailyNote(date, baseDir);
    if (content) {
      await extractFromFrontmatterInternal(content, baseDir);
      processed++;
    }
  }

  const afterCount = (await readAllEntities(baseDir)).length;
  return { processed, entities: afterCount - beforeCount };
}

/** Internal-only frontmatter extraction for backfill. Normal processing uses the agent. */
async function extractFromFrontmatterInternal(noteContent: string, baseDir?: string): Promise<void> {
  const frontmatter = parseFrontmatter(noteContent);
  if (!frontmatter) return;

  const date = (frontmatter.date as string) || new Date().toISOString().slice(0, 10);
  const entities: KnowledgeEntity[] = [];
  const projectSlugs: string[] = [];

  const projects = frontmatter.projects as string[] | undefined;
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (typeof p !== "string" || !p.trim()) continue;
      const name = path.basename(p);
      const slug = buildSlug("project", name);
      projectSlugs.push(slug);
      entities.push(makeEntity("project", name, date, "daily_note", {
        paths: [p],
        repo_names: [name],
        branches: [],
      }));
    }
  }

  const people = frontmatter.people as string[] | undefined;
  if (Array.isArray(people)) {
    for (const person of people) {
      if (typeof person !== "string" || !person.trim()) continue;
      entities.push(makeEntity("person", person, date, "daily_note", {
        aliases: [],
        associated_projects: [...projectSlugs],
      }));
    }
  }

  const topics = frontmatter.topics as string[] | undefined;
  if (Array.isArray(topics)) {
    for (const topic of topics) {
      if (typeof topic !== "string" || !topic.trim()) continue;
      entities.push(makeEntity("topic", topic, date, "daily_note", {
        keywords: [],
        associated_projects: [...projectSlugs],
      }));
    }
  }

  await ingestEntities(entities, baseDir);
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1]);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
