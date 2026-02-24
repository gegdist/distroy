import type { DiscordUser } from '@/lib/types/discord';

export const enum MsgType {
  TokenCaptured = 'TOKEN_CAPTURED',
  GetState = 'GET_STATE',
  StartScan = 'START_SCAN',
  StartDeletion = 'START_DELETION',
  PauseDeletion = 'PAUSE_DELETION',
  ResumeDeletion = 'RESUME_DELETION',
  CancelDeletion = 'CANCEL_DELETION',
  RetryDeletion = 'RETRY_DELETION',
  StateUpdate = 'STATE_UPDATE',
}

export type BgMessage =
  | { type: MsgType.TokenCaptured; token: string }
  | { type: MsgType.GetState }
  | { type: MsgType.StartScan }
  | { type: MsgType.StartDeletion; targetIds: string[] }
  | { type: MsgType.PauseDeletion }
  | { type: MsgType.ResumeDeletion }
  | { type: MsgType.CancelDeletion }
  | { type: MsgType.RetryDeletion };

export const enum JobPhase {
  Idle = 'idle',
  Scanning = 'scanning',
  ScanComplete = 'scan_complete',
  Deleting = 'deleting',
  Paused = 'paused',
  Done = 'done',
  Error = 'error',
}

export interface ScanTarget {
  id: string;
  name: string;
  type: 'guild' | 'dm';
  icon: string | null;
  messageCount: number;
}

export interface ScanOrderItem {
  id: string;
  name: string;
  type: 'guild' | 'dm';
  icon: string | null;
}

export const FAILURE_CATEGORIES = [
  'auth',
  'permission',
  'notFound',
  'rateLimited',
  'network',
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export type FailureSummary = Record<FailureCategory, number>;

export interface JobProgress {
  phase: JobPhase;
  hasToken: boolean;
  startedAt: number;
  scanTargets: ScanTarget[];
  scanOrder: ScanOrderItem[];
  scanActiveIndex: number;
  scanProgress: string;
  totalFound: number;
  deleted: number;
  failed: number;
  skipped: number;
  currentTarget: string;
  lastError: string;
  user: DiscordUser | null;
  failureSummary: FailureSummary;
}

export const enum LogLevel {
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Success = 'success',
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export type BgResponse =
  | { type: MsgType.StateUpdate; state: JobProgress; logs: LogEntry[] }
  | { ok: true }
  | { ok: false; error: string };

export const INJECTED_MSG_KEY = 'DISTROY_TOKEN' as const;

export function initialState(): JobProgress {
  return {
    phase: JobPhase.Idle,
    hasToken: false,
    startedAt: 0,
    scanTargets: [],
    scanOrder: [],
    scanActiveIndex: -1,
    scanProgress: '',
    totalFound: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    currentTarget: '',
    lastError: '',
    user: null,
    failureSummary: {
      auth: 0,
      permission: 0,
      notFound: 0,
      rateLimited: 0,
      network: 0,
      unknown: 0,
    },
  };
}
