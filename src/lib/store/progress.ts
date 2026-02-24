import type { JobProgress, LogEntry } from '@/lib/messaging/protocol';
import { initialState } from '@/lib/messaging/protocol';

const STORAGE_KEY = 'distroy_progress';
const LOG_KEY = 'distroy_logs';
const MAX_LOGS = 500;

export interface Checkpoint {
  state: JobProgress;
  selectedTargetIds: string[];
  completedTargets: string[];
  activeTargetId: string;
  currentOffset: number;
  processedInActiveTarget: number;
  updatedAt: number;
}

export function defaultCheckpoint(state?: JobProgress): Checkpoint {
  return {
    state: state ? { ...state } : initialState(),
    selectedTargetIds: [],
    completedTargets: [],
    activeTargetId: '',
    currentOffset: 0,
    processedInActiveTarget: 0,
    updatedAt: 0,
  };
}

export async function loadCheckpoint(): Promise<Checkpoint> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (raw && typeof raw === 'object') {
    return raw as Checkpoint;
  }
  return defaultCheckpoint();
}

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  cp.updatedAt = Date.now();
  await browser.storage.local.set({ [STORAGE_KEY]: cp });
}

export async function clearCheckpoint(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

export async function loadLogs(): Promise<LogEntry[]> {
  const result = await browser.storage.local.get(LOG_KEY);
  return (result[LOG_KEY] as LogEntry[] | undefined) ?? [];
}

export async function saveLogs(logs: LogEntry[]): Promise<void> {
  const trimmed = logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
  await browser.storage.local.set({ [LOG_KEY]: trimmed });
}

export async function clearLogs(): Promise<void> {
  await browser.storage.local.remove(LOG_KEY);
}
