import { ApiError, DiscordClient } from '@/lib/api/discord';
import {
  MsgType,
  JobPhase,
  LogLevel,
  initialState,
  type BgMessage,
  type BgResponse,
  type JobProgress,
  type LogEntry,
  type FailureCategory,
  type ScanOrderItem,
  type ScanTarget,
} from '@/lib/messaging/protocol';
import {
  defaultCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  loadLogs,
  saveLogs,
  clearLogs,
  type Checkpoint,
} from '@/lib/store/progress';
import type { DiscordGuild, DiscordChannel, DiscordMessage } from '@/lib/types/discord';
import { sleep, sleepOrAbort } from '@/lib/sleep';

const client = new DiscordClient();
let state: JobProgress = initialState();
let logs: LogEntry[] = [];
let checkpoint: Checkpoint = defaultCheckpoint();

let abortController: AbortController | null = null;
let paused = false;
let pausePromiseResolve: (() => void) | null = null;

let guilds: DiscordGuild[] = [];
let dmChannels: DiscordChannel[] = [];
let lastTargetIds: string[] = [];
const EMPTY_SEARCH_RETRY_MAX = 5;
const EMPTY_SEARCH_RETRY_BASE_MS = 1200;
const MIN_SCAN_ITEM_DURATION_MS = 1000;

function incrementFailure(category: FailureCategory): void {
  state.failureSummary[category] += 1;
}

function classifyDeleteError(err: unknown): FailureCategory {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'auth';
    if (err.status === 403) return 'permission';
    if (err.status === 404) return 'notFound';
    if (err.status === 429) return 'rateLimited';
    return 'unknown';
  }

  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return 'network';
  }
  return 'unknown';
}

function userAvatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith('a_') ? 'gif' : 'webp';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=32`;
}

function dmDisplayName(channel: DiscordChannel): string {
  return channel.recipients?.map((r) => r.username).join(', ') ?? `DM ${channel.id}`;
}

function dmDisplayIcon(channel: DiscordChannel): string | null {
  const firstRecipient = channel.recipients?.[0];
  if (!firstRecipient) return null;
  return userAvatarUrl(firstRecipient.id, firstRecipient.avatar);
}

function enablePanelOnActionClick(): void {
  const sidePanel = (globalThis as any).chrome?.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
    return;
  }

  const action = browser.action ?? (browser as any).browserAction;
  const sidebarAction = (browser as any).sidebarAction;
  if (!action?.onClicked || !sidebarAction?.open) return;

  action.onClicked.addListener(() => {
    sidebarAction.open().catch(() => {});
  });
}

async function log(level: LogLevel, message: string): Promise<void> {
  const entry: LogEntry = { timestamp: Date.now(), level, message };
  logs.push(entry);
  await saveLogs(logs);
  broadcastState();
}

function syncCheckpoint(): void {
  checkpoint.state = { ...state };
}

function broadcastState(): void {
  state.hasToken = client.hasToken();
  const msg: BgResponse = { type: MsgType.StateUpdate, state: { ...state }, logs: [...logs] };
  browser.runtime.sendMessage(msg).catch(() => {});
  updateBadge();
}

function updateBadge(): void {
  const action = browser.action ?? (browser as any).browserAction;
  if (!action) return;

  let text = '';
  let color = '#5865f2';

  switch (state.phase) {
    case JobPhase.Scanning:
      text = '...';
      break;
    case JobPhase.ScanComplete:
      text = String(state.scanTargets.length);
      color = '#5865f2';
      break;
    case JobPhase.Deleting: {
      const total = state.totalFound;
      const processed = state.deleted + state.failed + state.skipped;
      const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
      text = `${pct}%`;
      break;
    }
    case JobPhase.Paused:
      text = '||';
      color = '#fee75c';
      break;
    case JobPhase.Done:
      text = '\u2713';
      color = '#57f287';
      break;
    case JobPhase.Error:
      text = '!';
      color = '#ed4245';
      break;
    default:
      text = '';
  }

  action.setBadgeText({ text });
  action.setBadgeBackgroundColor({ color });
}

async function discover(signal: AbortSignal): Promise<void> {
  await log(LogLevel.Info, 'Fetching user info...');
  state.user = await client.getMe();
  await log(LogLevel.Info, `Logged in as ${state.user.username} (${state.user.id})`);

  if (signal.aborted) return;

  await log(LogLevel.Info, 'Fetching guilds...');
  guilds = await client.getGuilds();
  await log(LogLevel.Info, `Found ${guilds.length} guild(s)`);

  if (signal.aborted) return;

  await log(LogLevel.Info, 'Fetching DM channels...');
  dmChannels = await client.getDMChannels();
  await log(LogLevel.Info, `Found ${dmChannels.length} DM channel(s)`);
}

async function startScan(): Promise<void> {
  abortController?.abort();
  abortController = new AbortController();
  paused = false;
  const signal = abortController.signal;

  state = initialState();
  state.hasToken = client.hasToken();
  logs = [];
  await clearLogs();
  await clearCheckpoint();
  checkpoint = defaultCheckpoint(state);
  lastTargetIds = [];

  state.phase = JobPhase.Scanning;
  broadcastState();

  try {
    await discover(signal);
    if (signal.aborted) return;

    const userId = state.user!.id;
    const scanOrder: ScanOrderItem[] = [
      ...guilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        type: 'guild' as const,
        icon: guild.icon,
      })),
      ...dmChannels.map((channel) => ({
        id: channel.id,
        name: dmDisplayName(channel),
        type: 'dm' as const,
        icon: dmDisplayIcon(channel),
      })),
    ];
    state.scanOrder = scanOrder;
    state.scanActiveIndex = -1;
    broadcastState();

    const targets: ScanTarget[] = [];
    const totalTargets = scanOrder.length;

    for (let index = 0; index < scanOrder.length; index++) {
      if (signal.aborted) return;
      const target = scanOrder[index];
      state.scanActiveIndex = index;
      state.scanProgress = `${index + 1} / ${totalTargets}`;
      state.currentTarget = target.name;
      broadcastState();
      const itemStartedAt = Date.now();

      try {
        const result =
          target.type === 'guild'
            ? await client.searchGuild(target.id, userId, 0)
            : await client.searchChannel(target.id, userId, 0);
        if (result.total_results > 0) {
          targets.push({
            id: target.id,
            name: target.name,
            type: target.type,
            icon: target.icon,
            messageCount: result.total_results,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const targetLabel = target.type === 'guild' ? 'guild' : 'DM';
        await log(LogLevel.Warn, `Could not scan ${targetLabel} "${target.name}": ${errMsg}`);
      }

      const elapsedMs = Date.now() - itemStartedAt;
      const remainingMs = MIN_SCAN_ITEM_DURATION_MS - elapsedMs;
      if (remainingMs > 0) {
        await sleepOrAbort(remainingMs, signal);
      }
    }

    state.scanTargets = targets;
    state.scanActiveIndex = totalTargets > 0 ? totalTargets - 1 : -1;
    state.currentTarget = '';
    state.scanProgress = '';

    const totalMessages = targets.reduce((sum, t) => sum + t.messageCount, 0);
    const guildCount = targets.filter((t) => t.type === 'guild').length;
    const dmCount = targets.filter((t) => t.type === 'dm').length;

    if (targets.length === 0) {
      await log(LogLevel.Info, 'No messages found in any server or conversation.');
    } else {
      await log(
        LogLevel.Success,
        `Scan complete: ${totalMessages.toLocaleString()} message(s) across ${guildCount} server(s) and ${dmCount} conversation(s).`,
      );
    }

    state.phase = JobPhase.ScanComplete;
    checkpoint = defaultCheckpoint(state);
    await saveCheckpoint(checkpoint);
  } catch (err) {
    if (signal.aborted) return;
    state.phase = JobPhase.Error;
    const errMsg = err instanceof Error ? err.message : String(err);
    state.lastError = errMsg;
    await log(LogLevel.Error, `Scan failed: ${errMsg}`);
    checkpoint = defaultCheckpoint(state);
    await saveCheckpoint(checkpoint);
  }

  broadcastState();
}

async function waitIfPaused(signal: AbortSignal): Promise<void> {
  if (!paused) return;
  state.phase = JobPhase.Paused;
  broadcastState();
  await new Promise<void>((resolve) => {
    pausePromiseResolve = resolve;
    const onAbort = () => {
      pausePromiseResolve = null;
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  if (!signal.aborted && state.phase === JobPhase.Paused) {
    state.phase = JobPhase.Deleting;
    broadcastState();
  }
}

async function searchAndDeleteTarget(
  target: ScanTarget,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  state.currentTarget = target.name;
  checkpoint.activeTargetId = target.id;
  syncCheckpoint();
  broadcastState();

  const userId = state.user!.id;
  let offset = checkpoint.currentOffset;
  let emptySearchRetries = 0;
  const handledMessageIds = new Set<string>();
  const targetStartDeleted = state.deleted;
  const targetStartFailed = state.failed;
  const targetStartSkipped = state.skipped;
  const processedAtResume = checkpoint.processedInActiveTarget;

  if (processedAtResume > 0) {
    await log(
      LogLevel.Info,
      `Resuming "${target.name}" from last checkpoint (${processedAtResume} processed in target).`,
    );
  }

  await log(LogLevel.Info, `Deleting messages in "${target.name}"...`);

  while (!signal.aborted) {
    await waitIfPaused(signal);
    if (signal.aborted) return;

    const result =
      target.type === 'guild'
        ? await client.searchGuild(target.id, userId, offset)
        : await client.searchChannel(target.id, userId, offset);

    const messages: DiscordMessage[] = result.messages.flat();
    const freshMessages = messages.filter((msg) => {
      if (msg.author.id !== userId) return false;
      return !handledMessageIds.has(msg.id);
    });

    if (freshMessages.length === 0) {
      const processedInTarget =
        (state.deleted - targetStartDeleted) +
        (state.failed - targetStartFailed) +
        (state.skipped - targetStartSkipped);
      const expectedRemaining = Math.max(target.messageCount - processedInTarget, 0);

      if (expectedRemaining > 0 && emptySearchRetries < EMPTY_SEARCH_RETRY_MAX) {
        emptySearchRetries++;
        const waitMs = EMPTY_SEARCH_RETRY_BASE_MS * emptySearchRetries;
        await log(
          LogLevel.Warn,
          `Search returned no new messages for "${target.name}" but about ${expectedRemaining} may remain. Retrying (${emptySearchRetries}/${EMPTY_SEARCH_RETRY_MAX})...`,
        );
        await sleep(waitMs);
        continue;
      }

      if (expectedRemaining > 0) {
        await log(
          LogLevel.Warn,
          `Stopping "${target.name}" after ${EMPTY_SEARCH_RETRY_MAX} empty search retries. About ${expectedRemaining} message(s) may remain due Discord search lag.`,
        );
      }
      break;
    }
    emptySearchRetries = 0;

    for (const msg of freshMessages) {
      if (signal.aborted) return;
      await waitIfPaused(signal);
      if (signal.aborted) return;

      handledMessageIds.add(msg.id);

      try {
        const { deleted, reason } = await client.deleteMessage(msg.channel_id, msg.id);
        if (deleted) {
          state.deleted++;
        } else {
          state.skipped++;
          if (reason === 'permission') incrementFailure('permission');
          if (reason === 'notFound') incrementFailure('notFound');
          await log(LogLevel.Warn, `Skipped message ${msg.id} (not found or no permission)`);
        }
      } catch (err) {
        state.failed++;
        incrementFailure(classifyDeleteError(err));
        const errMsg = err instanceof Error ? err.message : String(err);
        await log(LogLevel.Error, `Failed to delete ${msg.id}: ${errMsg}`);
      }

      checkpoint.processedInActiveTarget =
        (state.deleted - targetStartDeleted) +
        (state.failed - targetStartFailed) +
        (state.skipped - targetStartSkipped);
      syncCheckpoint();
      broadcastState();
    }

    // After deleting a page, search from offset 0 (deleted messages shift indices)
    offset = 0;
    checkpoint.currentOffset = offset;
    syncCheckpoint();
    await saveCheckpoint(checkpoint);
  }
}

async function startDeletion(
  targetIds: string[],
  options: { resumeFromCheckpoint?: boolean } = {},
): Promise<void> {
  const resumeFromCheckpoint = options.resumeFromCheckpoint === true;
  abortController?.abort();
  abortController = new AbortController();
  paused = false;
  lastTargetIds = targetIds.length > 0 ? [...targetIds] : [...checkpoint.selectedTargetIds];
  const signal = abortController.signal;

  const selected = state.scanTargets.filter((t) => lastTargetIds.includes(t.id));
  if (selected.length === 0) {
    state.phase = JobPhase.Error;
    state.lastError = 'No selected targets to resume.';
    await log(LogLevel.Error, state.lastError);
    broadcastState();
    return;
  }

  state.totalFound = selected.reduce((sum, t) => sum + t.messageCount, 0);

  if (!resumeFromCheckpoint) {
    state.deleted = 0;
    state.failed = 0;
    state.skipped = 0;
    state.failureSummary = { ...initialState().failureSummary };
    state.startedAt = Date.now();
  }
  if (state.startedAt === 0) {
    state.startedAt = Date.now();
  }
  state.phase = JobPhase.Deleting;
  state.lastError = '';
  broadcastState();

  if (!resumeFromCheckpoint) {
    checkpoint = defaultCheckpoint(state);
    checkpoint.selectedTargetIds = [...lastTargetIds];
    await saveCheckpoint(checkpoint);
  } else {
    checkpoint.selectedTargetIds = [...lastTargetIds];
    syncCheckpoint();
    await saveCheckpoint(checkpoint);
    await log(LogLevel.Info, 'Resuming deletion from saved checkpoint.');
  }

  try {
    for (const target of selected) {
      if (signal.aborted) return;
      if (checkpoint.completedTargets.includes(target.id)) {
        await log(LogLevel.Info, `Skipping already-processed "${target.name}"`);
        continue;
      }

      if (checkpoint.activeTargetId !== target.id) {
        checkpoint.activeTargetId = target.id;
        checkpoint.processedInActiveTarget = 0;
        checkpoint.currentOffset = 0;
      }

      await searchAndDeleteTarget(target, signal);
      if (signal.aborted) return;

      checkpoint.completedTargets.push(target.id);
      checkpoint.activeTargetId = '';
      checkpoint.processedInActiveTarget = 0;
      checkpoint.currentOffset = 0;
      syncCheckpoint();
      await saveCheckpoint(checkpoint);
    }

    if (!signal.aborted) {
      const processed = state.deleted + state.failed + state.skipped;
      if (processed < state.totalFound) {
        await log(
          LogLevel.Warn,
          `Deletion ended with ${processed}/${state.totalFound} processed. Discord search can lag; run Scan again to continue remaining messages.`,
        );
      }
      state.phase = JobPhase.Done;
      await log(
        LogLevel.Success,
        `Finished. Deleted: ${state.deleted}, Failed: ${state.failed}, Skipped: ${state.skipped}`,
      );
      await clearCheckpoint();
    }
  } catch (err) {
    if (signal.aborted) return;
    state.phase = JobPhase.Error;
    const errMsg = err instanceof Error ? err.message : String(err);
    state.lastError = errMsg;
    await log(LogLevel.Error, `Deletion failed: ${errMsg}`);
    syncCheckpoint();
    await saveCheckpoint(checkpoint);
  }

  broadcastState();
}

export default defineBackground(() => {
  enablePanelOnActionClick();

  loadLogs().then((stored) => {
    logs = stored;
  });

  loadCheckpoint().then((cp) => {
    const restoredState: JobProgress = { ...initialState(), ...cp.state };
    checkpoint = {
      ...cp,
      state: restoredState,
      selectedTargetIds: Array.isArray(cp.selectedTargetIds) ? cp.selectedTargetIds : [],
      completedTargets: Array.isArray(cp.completedTargets) ? cp.completedTargets : [],
      activeTargetId: typeof cp.activeTargetId === 'string' ? cp.activeTargetId : '',
      currentOffset: typeof cp.currentOffset === 'number' ? cp.currentOffset : 0,
      processedInActiveTarget:
        typeof cp.processedInActiveTarget === 'number' ? cp.processedInActiveTarget : 0,
    };
    lastTargetIds = [...checkpoint.selectedTargetIds];
    if (
      restoredState.phase !== JobPhase.Idle &&
      restoredState.phase !== JobPhase.Done &&
      restoredState.phase !== JobPhase.ScanComplete
    ) {
      state = restoredState;
      state.phase = JobPhase.Paused;
    } else {
      state = restoredState;
    }
  });

  browser.runtime.onMessage.addListener(
    (message: BgMessage, _sender, sendResponse) => {
      const handle = async (): Promise<BgResponse> => {
        switch (message.type) {
          case MsgType.TokenCaptured:
            client.setToken(message.token);
            state.hasToken = true;
            broadcastState();
            return { ok: true };

          case MsgType.GetState:
            state.hasToken = client.hasToken();
            return { type: MsgType.StateUpdate, state: { ...state }, logs: [...logs] };

          case MsgType.StartScan:
            if (!client.hasToken()) {
              return { ok: false, error: 'No auth token captured. Open Discord and log in.' };
            }
            startScan();
            return { ok: true };

          case MsgType.StartDeletion:
            if (!client.hasToken()) {
              return { ok: false, error: 'No auth token captured. Open Discord and log in.' };
            }
            if (state.scanTargets.length === 0) {
              return { ok: false, error: 'No scan results. Run a scan first.' };
            }
            startDeletion(message.targetIds);
            return { ok: true };

          case MsgType.PauseDeletion:
            paused = true;
            return { ok: true };

          case MsgType.ResumeDeletion:
            paused = false;
            if (pausePromiseResolve) {
              pausePromiseResolve();
              pausePromiseResolve = null;
            }
            return { ok: true };

          case MsgType.CancelDeletion:
            abortController?.abort();
            paused = false;
            if (pausePromiseResolve) {
              pausePromiseResolve();
              pausePromiseResolve = null;
            }
            await clearCheckpoint();
            await clearLogs();
            logs = [];
            state = initialState();
            state.hasToken = client.hasToken();
            checkpoint = defaultCheckpoint(state);
            lastTargetIds = [];
            broadcastState();
            return { ok: true };

          case MsgType.RetryDeletion:
            if (!client.hasToken()) {
              return { ok: false, error: 'No auth token captured. Open Discord and log in.' };
            }
            if (
              state.scanTargets.length > 0 &&
              checkpoint.selectedTargetIds.length > 0 &&
              (state.phase === JobPhase.Paused || state.phase === JobPhase.Error)
            ) {
              startDeletion(checkpoint.selectedTargetIds, { resumeFromCheckpoint: true });
            } else if (state.scanTargets.length > 0 && lastTargetIds.length > 0) {
              startDeletion(lastTargetIds);
            } else {
              startScan();
            }
            return { ok: true };

          default:
            return { ok: false, error: 'Unknown message type' };
        }
      };

      handle().then(sendResponse);
      return true;
    },
  );
});
