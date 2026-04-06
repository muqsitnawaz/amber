import Anthropic from "@anthropic-ai/sdk";

export interface EntityMention {
  sessionId: string;
  context: string;
  timestamp: string;
}

export interface CompiledPage {
  content: string;
  related: string[];
}

export interface PendingCompilation {
  name: string;
  type: "project" | "person" | "topic";
  mentions: EntityMention[];
}

export interface CompiledResult {
  name: string;
  type: "project" | "person" | "topic";
  page: CompiledPage;
}

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 900;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 800;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable for Anthropic SDK.");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

function buildPrompt(
  name: string,
  type: "project" | "person" | "topic",
  mentions: EntityMention[],
): string {
  const mentionLines = mentions
    .map((m) => `- [${m.timestamp}] ${m.context}`)
    .join("\n");

  return `You are compiling a wiki page for "${name}" (${type}).\n\n`
    + `Raw mentions from AI chat sessions:\n${mentionLines}\n\n`
    + `Generate a concise personal wiki page in markdown:\n`
    + `- Start with a one-paragraph summary\n`
    + `- Add key facts as bullet points (only what's evident from mentions)\n`
    + `- Link related entities using [[Entity Name]] syntax\n`
    + `- Include a "## Related" section with links\n`
    + `- No speculation - only facts from the mentions\n`
    + `- Keep it under 500 words\n\n`
    + `Format:\n`
    + `# ${name}\n\n`
    + `[summary paragraph]\n\n`
    + `## Key Facts\n`
    + `- fact 1\n`
    + `- fact 2\n\n`
    + `## Related\n`
    + `- [[Related Entity 1]]\n`
    + `- [[Related Entity 2]]`;
}

function extractWikiLinks(content: string): string[] {
  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
    const label = match[1].trim();
    if (label) matches.add(label);
  }
  return Array.from(matches);
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; statusCode?: number; error?: { type?: string }; name?: string };
  if (err.status === 429 || err.statusCode === 429) return true;
  if (err.error?.type === "rate_limit_error") return true;
  if (err.name === "RateLimitError") return true;
  if (err.error?.type === "overloaded_error") return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetries<T>(
  operation: () => Promise<T>,
  retries: number = DEFAULT_RETRIES,
  baseDelayMs: number = DEFAULT_BACKOFF_MS,
  maxDelayMs: number = DEFAULT_MAX_BACKOFF_MS,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= retries) {
        throw error;
      }
      const jitter = Math.floor(Math.random() * 200);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + jitter;
      attempt += 1;
      await sleep(delay);
    }
  }
}

function extractTextContent(response: Anthropic.Message): string {
  const parts = response.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""));
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("Anthropic response did not include text content.");
  }
  return text;
}

export async function compileWikiPage(
  name: string,
  type: "project" | "person" | "topic",
  mentions: EntityMention[],
): Promise<CompiledPage> {
  const client = getClient();
  const prompt = buildPrompt(name, type, mentions);

  const response = await withRateLimitRetries(() => client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  }));

  const content = extractTextContent(response);
  const related = extractWikiLinks(content);

  return { content, related };
}

export async function compileAllPending(pending: PendingCompilation[]): Promise<CompiledResult[]> {
  const results: CompiledResult[] = [];
  for (const item of pending) {
    const page = await compileWikiPage(item.name, item.type, item.mentions);
    results.push({ name: item.name, type: item.type, page });
  }
  return results;
}
