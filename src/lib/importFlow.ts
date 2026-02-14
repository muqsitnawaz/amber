import { type ImportProgress, type ProcessingProgress } from "./api";

export interface ImportFlowDeps {
  runImport: (agentId: string, cutoffDays: number) => Promise<ImportProgress>;
  processDates: (dates: string[]) => Promise<{ processed: number; failed: string[] }>;
  onProgress?: (cb: (progress: ProcessingProgress) => void) => void;
  offProgress?: () => void;
}

export interface ImportFlowRequest {
  agentId: string;
  cutoffDays: number;
  deps: ImportFlowDeps;
  onProgress?: (progress: ProcessingProgress) => void;
  onAutoProcessStart?: (agentId: string, totalDates: number) => void;
}

export async function runImportWithAutoProcess({
  agentId,
  cutoffDays,
  deps,
  onProgress,
  onAutoProcessStart,
}: ImportFlowRequest): Promise<ImportProgress> {
  const result = await deps.runImport(agentId, cutoffDays);
  if (!result.dates || result.dates.length === 0) {
    return result;
  }

  onAutoProcessStart?.(agentId, result.dates.length);

  let progressUnsubscribe: (() => void) | null = null;
  if (onProgress && deps.onProgress) {
    deps.onProgress(onProgress);
    if (deps.offProgress) {
      progressUnsubscribe = deps.offProgress;
    }
  }

  try {
    await deps.processDates(result.dates);
  } finally {
    if (progressUnsubscribe) {
      progressUnsubscribe();
    }
  }

  return result;
}
