import * as fs from "fs/promises";
import * as path from "path";
import { resolveBaseDir } from "./storage";

export interface WikiPage {
  id: string;
  title: string;
  type: "project" | "person" | "topic";
  content: string;
  sources: string[];
  related: string[];
  created_at: string;
  updated_at: string;
}

const WIKI_FILE = "wiki.jsonl";

async function getWikiPath(baseDir?: string): Promise<string> {
  return path.join(resolveBaseDir(baseDir), WIKI_FILE);
}

export async function listWikiPages(type?: string, baseDir?: string): Promise<WikiPage[]> {
  const filePath = await getWikiPath(baseDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const pages: WikiPage[] = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    if (type && ["project", "person", "topic"].includes(type)) {
      return pages.filter((p) => p.type === type);
    }
    return pages;
  } catch {
    return [];
  }
}

export async function getWikiPage(id: string, baseDir?: string): Promise<WikiPage | null> {
  const pages = await listWikiPages(undefined, baseDir);
  return pages.find((p) => p.id === id) ?? null;
}

export async function searchWiki(query: string, baseDir?: string): Promise<WikiPage[]> {
  const pages = await listWikiPages(undefined, baseDir);
  const lower = query.toLowerCase();
  return pages.filter(
    (p) =>
      p.title.toLowerCase().includes(lower) ||
      p.content.toLowerCase().includes(lower)
  );
}

export async function upsertWikiPage(page: WikiPage, baseDir?: string): Promise<void> {
  const pages = await listWikiPages(undefined, baseDir);
  const idx = pages.findIndex((p) => p.id === page.id);
  if (idx >= 0) {
    pages[idx] = page;
  } else {
    pages.push(page);
  }
  await writeAllWikiPages(pages, baseDir);
}

export async function updateWikiPage(id: string, content: string, baseDir?: string): Promise<void> {
  const page = await getWikiPage(id, baseDir);
  if (!page) {
    throw new Error(`Wiki page "${id}" not found`);
  }
  page.content = content;
  page.updated_at = new Date().toISOString();
  await upsertWikiPage(page, baseDir);
}

export async function deleteWikiPage(id: string, baseDir?: string): Promise<void> {
  const pages = await listWikiPages(undefined, baseDir);
  const filtered = pages.filter((p) => p.id !== id);
  await writeAllWikiPages(filtered, baseDir);
}

async function writeAllWikiPages(pages: WikiPage[], baseDir?: string): Promise<void> {
  const filePath = await getWikiPath(baseDir);
  const content = pages.map((p) => JSON.stringify(p)).join("\n") + (pages.length ? "\n" : "");
  await fs.writeFile(filePath, content, "utf-8");
}

export function createWikiPage(
  title: string,
  type: "project" | "person" | "topic",
  content: string,
  sources: string[] = [],
  related: string[] = []
): WikiPage {
  const now = new Date().toISOString();
  return {
    id: slugify(title),
    title,
    type,
    content,
    sources,
    related,
    created_at: now,
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
