import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { RawEvent, PinRecord, KnowledgeEntity, EntityType } from "./types";

export function resolveBaseDir(baseDir?: string): string {
  if (baseDir && baseDir !== "~/.amber") {
    const expanded = baseDir.replace(/^~/, os.homedir());
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), ".amber");
}

export async function ensureDirs(baseDir?: string): Promise<void> {
  const base = resolveBaseDir(baseDir);
  await fs.mkdir(path.join(base, "daily"), { recursive: true });
  await fs.mkdir(path.join(base, "staging"), { recursive: true });
}

export async function readDailyNote(date: string, baseDir?: string): Promise<string | null> {
  const filePath = path.join(resolveBaseDir(baseDir), "daily", `${date}.md`);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function writeDailyNote(date: string, content: string, baseDir?: string): Promise<void> {
  const dirPath = path.join(resolveBaseDir(baseDir), "daily");
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, `${date}.md`), content, "utf-8");
}

export async function appendStagingEvent(date: string, event: RawEvent, baseDir?: string): Promise<void> {
  const dirPath = path.join(resolveBaseDir(baseDir), "staging");
  await fs.mkdir(dirPath, { recursive: true });
  await fs.appendFile(path.join(dirPath, `${date}.jsonl`), JSON.stringify(event) + "\n", "utf-8");
}

export async function readStagingEvents(date: string, baseDir?: string): Promise<string[]> {
  const filePath = path.join(resolveBaseDir(baseDir), "staging", `${date}.jsonl`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function clearStaging(date: string, baseDir?: string): Promise<void> {
  const filePath = path.join(resolveBaseDir(baseDir), "staging", `${date}.jsonl`);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist
  }
}

export async function listDailyNotes(baseDir?: string): Promise<string[]> {
  const dirPath = path.join(resolveBaseDir(baseDir), "daily");
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => f.endsWith(".md")).map(f => f.replace(".md", ""));
  } catch {
    return [];
  }
}

export async function listStagingDates(baseDir?: string): Promise<string[]> {
  const dirPath = path.join(resolveBaseDir(baseDir), "staging");
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", ""));
  } catch {
    return [];
  }
}

// ── Pin Storage ──

export async function appendPin(pin: PinRecord, baseDir?: string): Promise<void> {
  const filePath = path.join(resolveBaseDir(baseDir), "pins.jsonl");
  await fs.appendFile(filePath, JSON.stringify(pin) + "\n", "utf-8");
}

export async function readAllPins(baseDir?: string): Promise<PinRecord[]> {
  const filePath = path.join(resolveBaseDir(baseDir), "pins.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function removePin(pinId: string, baseDir?: string): Promise<void> {
  const base = resolveBaseDir(baseDir);
  const filePath = path.join(base, "pins.jsonl");
  const all = await readAllPins(baseDir);
  const filtered = all.filter(p => p.id !== pinId);
  await fs.writeFile(filePath, filtered.map(p => JSON.stringify(p)).join("\n") + (filtered.length ? "\n" : ""), "utf-8");
}

export async function readPinsForDate(date: string, baseDir?: string): Promise<PinRecord[]> {
  const all = await readAllPins(baseDir);
  return all.filter(p => p.date === date);
}

// ── Knowledge Storage ──

export async function readAllEntities(baseDir?: string): Promise<KnowledgeEntity[]> {
  const filePath = path.join(resolveBaseDir(baseDir), "knowledge.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function writeAllEntities(entities: KnowledgeEntity[], baseDir?: string): Promise<void> {
  const filePath = path.join(resolveBaseDir(baseDir), "knowledge.jsonl");
  await fs.writeFile(
    filePath,
    entities.map(e => JSON.stringify(e)).join("\n") + (entities.length ? "\n" : ""),
    "utf-8",
  );
}

export async function upsertEntity(entity: KnowledgeEntity, baseDir?: string): Promise<void> {
  const all = await readAllEntities(baseDir);
  const idx = all.findIndex(e => e.slug === entity.slug);
  if (idx >= 0) {
    all[idx] = mergeStoredEntity(all[idx], entity);
  } else {
    all.push(entity);
  }
  await writeAllEntities(all, baseDir);
}

export async function readEntitiesByType(type: EntityType, baseDir?: string): Promise<KnowledgeEntity[]> {
  const all = await readAllEntities(baseDir);
  return all.filter(e => e.type === type);
}

export async function removeEntity(id: string, baseDir?: string): Promise<void> {
  const all = await readAllEntities(baseDir);
  const filtered = all.filter(e => e.id !== id);
  await writeAllEntities(filtered, baseDir);
}

function mergeStoredEntity(existing: KnowledgeEntity, incoming: KnowledgeEntity): KnowledgeEntity {
  const merged = { ...existing };
  merged.first_seen = existing.first_seen < incoming.first_seen ? existing.first_seen : incoming.first_seen;
  merged.last_seen = existing.last_seen > incoming.last_seen ? existing.last_seen : incoming.last_seen;
  merged.mention_count = existing.mention_count + incoming.mention_count;
  merged.sources = [...new Set([...existing.sources, ...incoming.sources])];

  // Merge metadata arrays
  const meta = { ...existing.metadata };
  for (const key of Object.keys(incoming.metadata)) {
    const existVal = meta[key];
    const incVal = incoming.metadata[key];
    if (Array.isArray(existVal) && Array.isArray(incVal)) {
      meta[key] = [...new Set([...existVal, ...incVal])];
    } else if (incVal !== undefined) {
      meta[key] = incVal;
    }
  }
  merged.metadata = meta;

  return merged;
}
