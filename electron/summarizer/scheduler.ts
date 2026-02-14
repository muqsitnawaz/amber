import { AmberConfig } from "../types";
import { processDay } from "./agent";
import { loadOrDefault } from "../config";
import { setAppState } from "../ipc";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastSummarizedDate: string | null = null;
let isSummarizing = false;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function runSummarize(date?: string): Promise<void> {
  if (isSummarizing) return;
  isSummarizing = true;

  try {
    const config = await loadOrDefault();
    const targetDate = date ?? todayISO();

    console.log(`Processing ${targetDate}...`);
    await processDay(targetDate, config);

    lastSummarizedDate = targetDate;
    setAppState({ lastSummarized: targetDate });
    console.log(`Processing complete for ${targetDate}`);
  } catch (err) {
    console.error("Processing failed:", err);
  } finally {
    isSummarizing = false;
  }
}

export function startScheduler(_config: AmberConfig): void {
  schedulerInterval = setInterval(async () => {
    const config = await loadOrDefault();
    const now = new Date();
    const today = todayISO();

    if (now.getHours() === config.schedule.daily_hour && lastSummarizedDate !== today) {
      await runSummarize(today);
    }
  }, 60_000);

  console.log("Scheduler started");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

export async function triggerManualSummarize(): Promise<void> {
  await runSummarize(todayISO());
}

export async function processDate(date: string): Promise<void> {
  const config = await loadOrDefault();
  await processDay(date, config);
}
