import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { ContextEntry } from "./types";

const execFileAsync = promisify(execFile);

export async function readChromeHistory(
  limit: number = 50,
  hoursBack: number = 24,
): Promise<ContextEntry[]> {
  const historyPath = path.join(
    os.homedir(),
    "Library/Application Support/Google/Chrome/Default/History",
  );

  try {
    // Chrome locks the file while running — copy to temp with random name
    const tmpPath = path.join(os.tmpdir(), `amber-chrome-${crypto.randomBytes(8).toString("hex")}`);
    await fs.copyFile(historyPath, tmpPath);

    // Chrome timestamps are microseconds since 1601-01-01
    // Convert to Unix: subtract 11644473600 seconds, divide by 1000000
    const safeLimit = Math.floor(Math.abs(limit));
    const safeHoursBack = Math.floor(Math.abs(hoursBack));
    const cutoffChrome =
      (Math.floor(Date.now() / 1000) + 11644473600 - safeHoursBack * 3600) *
      1000000;

    const { stdout } = await execFileAsync("sqlite3", [
      tmpPath,
      "-separator",
      "\t",
      `SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > ${cutoffChrome} ORDER BY last_visit_time DESC LIMIT ${safeLimit}`,
    ]);

    await fs.unlink(tmpPath).catch(() => {});

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, i) => {
        const [url, title, visitTime] = line.split("\t");
        const unixMs =
          (parseInt(visitTime) / 1000000 - 11644473600) * 1000;
        return {
          id: `chrome-${i}-${visitTime}`,
          source: "chrome",
          timestamp: new Date(unixMs).toISOString(),
          kind: "browse" as const,
          title: title || url,
          data: { url },
        };
      });
  } catch {
    return [];
  }
}

export async function readSafariHistory(
  limit: number = 50,
  hoursBack: number = 24,
): Promise<ContextEntry[]> {
  const historyPath = path.join(os.homedir(), "Library/Safari/History.db");

  try {
    const tmpPath = path.join(os.tmpdir(), `amber-safari-${crypto.randomBytes(8).toString("hex")}`);
    await fs.copyFile(historyPath, tmpPath);

    // Safari stores visit_time as seconds since 2001-01-01 (Core Data timestamp)
    const safeLimit = Math.floor(Math.abs(limit));
    const safeHoursBack = Math.floor(Math.abs(hoursBack));
    const cutoffSafari =
      Math.floor(Date.now() / 1000) - 978307200 - safeHoursBack * 3600;

    const { stdout } = await execFileAsync("sqlite3", [
      tmpPath,
      "-separator",
      "\t",
      `SELECT hi.url, hv.title, hv.visit_time
       FROM history_visits hv
       JOIN history_items hi ON hv.history_item = hi.id
       WHERE hv.visit_time > ${cutoffSafari}
       ORDER BY hv.visit_time DESC
       LIMIT ${safeLimit}`,
    ]);

    await fs.unlink(tmpPath).catch(() => {});

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, i) => {
        const [url, title, visitTime] = line.split("\t");
        const unixMs = (parseFloat(visitTime) + 978307200) * 1000;
        return {
          id: `safari-${i}-${visitTime}`,
          source: "safari",
          timestamp: new Date(unixMs).toISOString(),
          kind: "browse" as const,
          title: title || url,
          data: { url },
        };
      });
  } catch {
    return [];
  }
}
