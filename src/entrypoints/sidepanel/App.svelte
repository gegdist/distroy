<script lang="ts">
  import {
    MsgType,
    JobPhase,
    LogLevel,
    type BgMessage,
    type JobProgress,
    type LogEntry,
    type BgResponse,
  } from '@/lib/messaging/protocol';
  import { t } from '@/lib/i18n';
  import Button from './Button.svelte';
  import Card from './Card.svelte';
  import LogDrawer from './LogDrawer.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ScanConveyor from './ScanConveyor.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import StatCell from './StatCell.svelte';
  import StatusIndicator from './StatusIndicator.svelte';
  import TargetRow from './TargetRow.svelte';

  let job: JobProgress = $state({
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
  });

  let logs: LogEntry[] = $state([]);
  let errorMsg: string = $state('');
  let selectedTargets: Set<string> = $state(new Set());
  let targetFilter: string = $state('');
  let confirmingDelete: boolean = $state(false);
  let showLogs: boolean = $state(false);
  let statusAnnouncement = $state('');
  let targetFilterInput: HTMLInputElement | null = $state(null);
  let previousPhase: JobPhase = JobPhase.Idle;
  let selectionInitialized = false;
  let tick = $state(0);
  const logPanelId = 'distroy-log-panel';

  const isScanning = $derived(job.phase === JobPhase.Scanning);
  const isScanComplete = $derived(job.phase === JobPhase.ScanComplete);
  const isDeleting = $derived(job.phase === JobPhase.Deleting);
  const isPaused = $derived(job.phase === JobPhase.Paused);
  const isDone = $derived(job.phase === JobPhase.Done);
  const isIdle = $derived(job.phase === JobPhase.Idle);
  const isError = $derived(job.phase === JobPhase.Error);

  const hasStats = $derived(isDeleting || isPaused || isDone);
  const processed = $derived(job.deleted + job.failed + job.skipped);
  const boundedProcessed = $derived(
    job.totalFound > 0 ? Math.min(processed, job.totalFound) : processed
  );
  const progressPct = $derived(
    job.totalFound > 0 ? Math.min(100, Math.round((processed / job.totalFound) * 100)) : 0
  );

  const selectedMessageCount = $derived(
    job.scanTargets
      .filter((tgt) => selectedTargets.has(tgt.id))
      .reduce((sum, tgt) => sum + tgt.messageCount, 0)
  );

  const selectedCount = $derived(selectedTargets.size);

  const filteredTargets = $derived(
    targetFilter.trim()
      ? job.scanTargets.filter((tgt) =>
          tgt.name.toLowerCase().includes(targetFilter.trim().toLowerCase())
        )
      : job.scanTargets
  );

  const guildTargets = $derived(filteredTargets.filter((tgt) => tgt.type === 'guild'));
  const dmTargets = $derived(filteredTargets.filter((tgt) => tgt.type === 'dm'));
  const failureItems = $derived.by(() => {
    const map = job.failureSummary;
    return [
      { key: 'auth', count: map.auth, label: t('triage_category_auth') },
      { key: 'permission', count: map.permission, label: t('triage_category_permission') },
      { key: 'notFound', count: map.notFound, label: t('triage_category_not_found') },
      { key: 'rateLimited', count: map.rateLimited, label: t('triage_category_rate_limited') },
      { key: 'network', count: map.network, label: t('triage_category_network') },
      { key: 'unknown', count: map.unknown, label: t('triage_category_unknown') },
    ].filter((entry) => entry.count > 0);
  });
  const hasFailureTriage = $derived(failureItems.length > 0);
  const dominantFailureHint = $derived.by(() => {
    if (job.failureSummary.auth > 0) return t('triage_hint_auth');
    if (job.failureSummary.permission > 0) return t('triage_hint_permission');
    if (job.failureSummary.rateLimited > 0) return t('triage_hint_rate_limited');
    if (job.failureSummary.network > 0) return t('triage_hint_network');
    if (job.failureSummary.notFound > 0) return t('triage_hint_not_found');
    return t('triage_hint_unknown');
  });

  let smoothedRate = 0;
  let lastSmoothedProcessed = 0;

  // Update smoothed rate as a side effect (keeps $derived pure)
  $effect(() => {
    if (!isDeleting || boundedProcessed === 0 || job.startedAt === 0) {
      smoothedRate = 0;
      lastSmoothedProcessed = 0;
      return;
    }
    const elapsed = Date.now() - job.startedAt;
    const instantRate = boundedProcessed / elapsed;
    if (lastSmoothedProcessed === 0 || smoothedRate === 0) {
      smoothedRate = instantRate;
    } else if (boundedProcessed !== lastSmoothedProcessed) {
      smoothedRate = 0.3 * instantRate + 0.7 * smoothedRate;
    }
    lastSmoothedProcessed = boundedProcessed;
  });

  const etaText = $derived.by(() => {
    void tick; // reactive dependency on tick for periodic updates
    if (!isDeleting || boundedProcessed === 0 || smoothedRate === 0) return '';
    const remaining = Math.max(0, job.totalFound - boundedProcessed);
    const etaMs = remaining / smoothedRate;

    if (etaMs < 60_000) return t('eta_less_than_one_min');
    const totalMins = Math.round(etaMs / 60_000);
    if (totalMins < 60) return t('eta_minutes', [String(totalMins)]);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return t('eta_hours_minutes', [String(hrs), String(mins)]);
  });

  const elapsedText = $derived.by(() => {
    void tick; // reactive dependency on tick for periodic updates
    if (job.startedAt === 0) return '';
    const ms = Date.now() - job.startedAt;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  });

  // Tick every second while actively running to keep elapsed/eta displays fresh
  $effect(() => {
    if (!isDeleting && !isPaused && !isDone) return;
    const interval = setInterval(() => { tick++; }, 1000);
    return () => clearInterval(interval);
  });

  const phaseLabel = $derived.by(() => {
    switch (job.phase) {
      case JobPhase.Scanning: return t('phase_scanning');
      case JobPhase.ScanComplete: return t('phase_scan_complete');
      case JobPhase.Deleting: return t('phase_deleting');
      case JobPhase.Paused: return t('phase_paused');
      case JobPhase.Done: return t('phase_complete');
      case JobPhase.Error: return t('phase_error');
      default: return t('phase_ready');
    }
  });

  const errorSummary = $derived.by(() => {
    const err = job.lastError;
    if (!err) return { title: t('error_generic'), hint: t('error_hint_generic') };
    if (err.includes('401') || err.toLowerCase().includes('unauthorized'))
      return { title: t('error_auth_expired'), hint: t('error_hint_auth') };
    if (err.includes('403') || err.toLowerCase().includes('forbidden'))
      return { title: t('error_access_denied'), hint: t('error_hint_access') };
    if (err.includes('429') || err.toLowerCase().includes('rate'))
      return { title: t('error_rate_limited'), hint: t('error_hint_rate') };
    if (err.toLowerCase().includes('network') || err.toLowerCase().includes('fetch'))
      return { title: t('error_network'), hint: t('error_hint_network') };
    return { title: t('error_generic'), hint: err };
  });

  const scanSummaryGuilds = $derived(job.scanTargets.filter((t) => t.type === 'guild').length);
  const scanSummaryDMs = $derived(job.scanTargets.filter((t) => t.type === 'dm').length);
  const scanSummaryMessages = $derived(job.scanTargets.reduce((s, t) => s + t.messageCount, 0));
  const connectedUserTooltip = $derived(job.user ? `${job.user.username} (${job.user.id})` : '');
  const scanningCurrentText = $derived(
    job.currentTarget ? t('scanning_label', [job.currentTarget]) : t('scanning_discovering')
  );

  function withDiscordCdnSize(url: string, size: number): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'cdn.discordapp.com') return url;
      parsed.searchParams.set('size', String(size));
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function targetIconUrl(id: string, hash: string | null, size = 32): string | null {
    if (!hash) return null;
    if (hash.startsWith('http://') || hash.startsWith('https://')) {
      return withDiscordCdnSize(hash, size);
    }
    const ext = hash.startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/icons/${id}/${hash}.${ext}?size=${size}`;
  }

  function targetInitial(name: string): string {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  const scanConveyorItems = $derived(
    job.scanOrder.map((target) => ({
      id: target.id,
      name: target.name,
      icon: targetIconUrl(target.id, target.icon, 128),
      initial: targetInitial(target.name),
    }))
  );

  async function send(msg: BgMessage): Promise<BgResponse> {
    return browser.runtime.sendMessage(msg);
  }

  function isStateUpdateResponse(
    message: unknown
  ): message is Extract<BgResponse, { type: MsgType.StateUpdate }> {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message as { type?: MsgType }).type === MsgType.StateUpdate
    );
  }

  function applyStateUpdate(nextState: JobProgress, nextLogs: LogEntry[]) {
    const prevPhase = job.phase;
    job = nextState;
    logs = nextLogs;
    // Auto-select all targets on first transition to ScanComplete
    if (job.scanTargets.length > 0 && !selectionInitialized) {
      // Only auto-select when freshly entering ScanComplete, not on checkpoint restore of other phases
      if (job.phase === JobPhase.ScanComplete && prevPhase !== JobPhase.ScanComplete) {
        selectedTargets = new Set(job.scanTargets.map((tgt) => tgt.id));
      }
      selectionInitialized = true;
    }
  }

  async function fetchState() {
    try {
      const res = await send({ type: MsgType.GetState });
      if (isStateUpdateResponse(res)) {
        applyStateUpdate(res.state, res.logs);
      }
    } catch {
      // Background worker may be starting up; periodic refresh will retry.
    }
  }

  function onRuntimeMessage(message: unknown) {
    if (!isStateUpdateResponse(message)) return;
    applyStateUpdate(message.state, message.logs);
  }

  $effect(() => {
    fetchState();
    browser.runtime.onMessage.addListener(onRuntimeMessage);
    const interval = setInterval(fetchState, 3000);
    return () => {
      clearInterval(interval);
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
    }
  });

  $effect(() => {
    if (previousPhase === job.phase) return;

    statusAnnouncement = `${phaseLabel}${job.currentTarget ? `: ${job.currentTarget}` : ''}`;
    if (job.phase === JobPhase.ScanComplete && targetFilterInput) {
      targetFilterInput.focus();
    } else if (job.phase === JobPhase.Error) {
      document.getElementById('retry-action-btn')?.focus();
    } else if (job.phase === JobPhase.Idle || job.phase === JobPhase.Done) {
      document.getElementById('scan-action-btn')?.focus();
    }

    previousPhase = job.phase;
  });

  async function startScan() {
    errorMsg = '';
    confirmingDelete = false;
    selectionInitialized = false;
    const res = await send({ type: MsgType.StartScan });
    if (res && 'ok' in res && !res.ok) errorMsg = res.error;
  }

  async function startDeletion() {
    errorMsg = '';
    confirmingDelete = false;
    const res = await send({ type: MsgType.StartDeletion, targetIds: [...selectedTargets] });
    if (res && 'ok' in res && !res.ok) errorMsg = res.error;
  }

  async function retryJob() {
    errorMsg = '';
    const res = await send({ type: MsgType.RetryDeletion });
    if (res && 'ok' in res && !res.ok) errorMsg = res.error;
  }

  async function pause() { await send({ type: MsgType.PauseDeletion }); }
  async function resume() { await send({ type: MsgType.ResumeDeletion }); }
  async function cancel() { await send({ type: MsgType.CancelDeletion }); }

  function dismissError() { errorMsg = ''; }
  function toggleLogs() { showLogs = !showLogs; }

  function toggleTarget(id: string) {
    const next = new Set(selectedTargets);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedTargets = next;
  }

  function selectAllTargets() {
    selectedTargets = new Set(job.scanTargets.map((tgt) => tgt.id));
  }

  function selectNoTargets() {
    selectedTargets = new Set();
  }

  function logColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.Error: return 'var(--color-danger)';
      case LogLevel.Warn: return 'var(--color-warning)';
      case LogLevel.Success: return 'var(--color-success)';
      default: return 'var(--color-text-tertiary)';
    }
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

</script>

<main
  class="flex h-full flex-1 flex-col"
  aria-busy={isScanning || isDeleting}
>
  <div class="sr-only" aria-live="polite" aria-atomic="true">{statusAnnouncement}</div>
  <header class="flex items-center justify-between bg-surface-strong p-4 rounded-lg rounded-b-none">
    <div class="flex items-center gap-2">
      <img class="size-8 rounded-lg shrink-0" src="icon/128.png" alt="" aria-hidden="true" />
      <div>
        <h1 class="text-base font-semibold leading-tight text-text">Distroy</h1>
        <span class="text-xs text-text-tertiary">{t('subtitle')}</span>
      </div>
    </div>
    <StatusIndicator
      connected={job.hasToken}
      connectedLabel={t('status_connected')}
      disconnectedLabel={t('status_awaiting_token')}
      connectedAriaLabel={t('aria_token_connected')}
      disconnectedAriaLabel={t('aria_awaiting_token')}
      tooltip={connectedUserTooltip}
    />
  </header>
  {#if errorMsg}
    <div class="flex items-center justify-between gap-2 rounded-xl border px-4 py-2 bg-danger-dim border-danger-border text-danger text-xs leading-snug">
      <span>{errorMsg}</span>
      <button class="bg-transparent border-none text-inherit text-lg leading-none px-1 cursor-pointer opacity-60 shrink-0 hover:opacity-100" onclick={dismissError} aria-label={t('aria_dismiss_error')}>
        &times;
      </button>
    </div>
  {/if}

  {#if isError}
    <Card variant="danger">
      <p class="text-xs font-medium text-danger">{errorSummary.title}</p>
      <p class="text-xs leading-snug text-text-secondary">{errorSummary.hint}</p>
      <div class="flex justify-end">
        <Button id="retry-action-btn" variant="primary" onclick={retryJob}>{t('btn_retry')}</Button>
      </div>
    </Card>
  {/if}

  {#if !job.hasToken && isIdle}
    <Card variant="danger">
      <p class="text-xs font-medium text-text-secondary">{t('no_token_title')}</p>
      <ol class="pl-5 flex flex-col gap-1 text-xs list-decimal leading-snug text-text-secondary">
        <li>{@html t('token_step_1', ['<a href="https://discord.com/channels/@me" target="_blank" rel="noreferrer" class="text-accent no-underline hover:underline">', '</a>'])}</li>
        <li>{t('token_step_2')}</li>
        <li>{t('token_step_3')}</li>
      </ol>
      <p class="text-xs text-text-tertiary">{t('token_hint')}</p>
    </Card>
  {/if}

  {#if isScanning}
      <ScanConveyor
        items={scanConveyorItems}
        activeIndex={job.scanActiveIndex}
        progressText={job.scanProgress}
        currentText={scanningCurrentText}
        discoveringText={t('scanning_discovering')}
      />
  {/if}

  {#if isScanComplete}
    <Card>
      <SectionHeader label={t('scan_results_title')}>
        {#snippet right()}
          <Button variant="link" onclick={startScan}>{t('btn_scan_again')}</Button>
        {/snippet}
      </SectionHeader>

      {#if job.scanTargets.length === 0}
        <p class="text-xs text-text-tertiary">{t('scan_no_messages')}</p>
      {:else}
        <p class="text-xs leading-snug text-text-secondary">
          {t('scan_summary', [String(scanSummaryMessages.toLocaleString()), String(scanSummaryGuilds), String(scanSummaryDMs)])}
        </p>

        <div class="flex items-center justify-between gap-2 pt-1">
          <input
            type="text"
            class="flex-1 bg-surface border border-surface-strong rounded-md px-2 py-2 outline-none transition-colors duration-150 text-text placeholder:text-text-tertiary focus:border-accent text-xs"
            placeholder={t('scope_filter_placeholder')}
            bind:value={targetFilter}
            bind:this={targetFilterInput}
            aria-label={t('aria_filter_scope')}
          />
          <div class="flex gap-2">
            <Button variant="link" onclick={selectAllTargets} disabled={selectedTargets.size === job.scanTargets.length}>{t('select_all')}</Button>
            <Button variant="link" onclick={selectNoTargets} disabled={selectedTargets.size === 0}>{t('select_none')}</Button>
          </div>
        </div>

        <div class="flex flex-col">
          {#if guildTargets.length > 0}
            <p class="text-xs font-semibold uppercase text-text-tertiary">{t('scope_servers')}</p>
            {#each guildTargets as tgt}
              <TargetRow
                name={tgt.name}
                count={tgt.messageCount}
                checked={selectedTargets.has(tgt.id)}
                icon={targetIconUrl(tgt.id, tgt.icon)}
                initial={targetInitial(tgt.name)}
                onchange={() => toggleTarget(tgt.id)}
              />
            {/each}
          {/if}

          {#if dmTargets.length > 0}
            <p class="text-xs font-semibold uppercase text-text-tertiary">{t('scope_dms')}</p>
            {#each dmTargets as tgt}
              <TargetRow
                name={tgt.name}
                count={tgt.messageCount}
                checked={selectedTargets.has(tgt.id)}
                icon={targetIconUrl(tgt.id, tgt.icon)}
                initial={targetInitial(tgt.name)}
                onchange={() => toggleTarget(tgt.id)}
              />
            {/each}
          {/if}

          {#if guildTargets.length === 0 && dmTargets.length === 0}
            <p class="text-xs text-text-tertiary">{t('scope_no_matches', [targetFilter])}</p>
          {/if}
        </div>

        {#if !confirmingDelete}
          <Button variant="danger" fullWidth onclick={() => confirmingDelete = true} disabled={selectedCount === 0}>
            {t('btn_delete_selected', [String(selectedMessageCount.toLocaleString())])}
          </Button>
        {:else}
          <div class="bg-danger-dim border border-danger-border-strong rounded-lg p-3 flex flex-col gap-2">
            <p class="text-xs font-medium text-danger">{t('confirm_delete_title')}</p>
            <p class="text-xs leading-snug text-text-secondary">{t('confirm_delete_body', [String(selectedMessageCount.toLocaleString())])}</p>
            <div class="flex gap-2">
              <Button variant="danger" onclick={startDeletion}>{t('confirm_delete_confirm')}</Button>
              <Button variant="secondary" onclick={() => confirmingDelete = false}>{t('confirm_delete_cancel')}</Button>
            </div>
          </div>
        {/if}
      {/if}
    </Card>
  {/if}

  {#if hasStats && job.totalFound > 0}
    <Card variant={isDone ? 'success' : 'default'}>
      {#if isDone}
        <div class="flex items-center gap-2">
          <span class="size-6 rounded-full flex items-center justify-center shrink-0 bg-success-dim text-success text-xs">&#10003;</span>
          <span class="text-sm font-medium text-success">{t('summary_deletion_complete')}</span>
          {#if elapsedText}
            <span class="text-xs text-text-tertiary">{elapsedText}</span>
          {/if}
        </div>
      {:else}
        <SectionHeader label={phaseLabel}>
          {#snippet right()}
            {#if job.currentTarget}
              <span class="text-xs text-text-tertiary max-w-44 overflow-hidden text-ellipsis whitespace-nowrap">{job.currentTarget}</span>
            {/if}
          {/snippet}
        </SectionHeader>
        <ProgressBar value={progressPct} active={isDeleting} />
        <div class="flex justify-between items-baseline" aria-live="polite">
          <span class="text-3xl font-light leading-none text-text">{progressPct}<span class="text-sm font-normal text-text-tertiary">%</span></span>
          {#if etaText}
            <span class="text-xs text-text-tertiary">{etaText}</span>
          {/if}
        </div>
      {/if}
      <div class="grid grid-cols-4 gap-1" aria-live="polite">
        <StatCell value={job.totalFound.toLocaleString()} label={t('stat_found')} />
        <StatCell value={job.deleted.toLocaleString()} label={t('stat_deleted')} color="var(--color-success)" />
        <StatCell value={job.failed.toLocaleString()} label={t('stat_failed')} color="var(--color-danger)" />
        <StatCell value={job.skipped.toLocaleString()} label={t('stat_skipped')} color="var(--color-text-tertiary)" />
      </div>
    </Card>
  {/if}

  {#if hasFailureTriage && (isDeleting || isPaused || isDone || isError)}
    <Card variant={isError ? 'danger' : 'default'}>
      <SectionHeader label={t('triage_title')} />
      <div class="grid grid-cols-2 gap-1" aria-live="polite">
        {#each failureItems as item (item.key)}
          <StatCell value={item.count.toLocaleString()} label={item.label} color="var(--color-warning)" />
        {/each}
      </div>
      <p class="text-xs leading-snug text-text-secondary">{dominantFailureHint}</p>
    </Card>
  {/if}

  <section class="flex items-center justify-end m-2 gap-2">
      {#if isIdle || isDone}
        <Button id="scan-action-btn" variant="primary" onclick={startScan} disabled={!job.hasToken}>
          {isDone ? t('btn_scan_again') : t('btn_scan')}
        </Button>
      {/if}
      {#if isScanning}
        <Button variant="secondary" onclick={cancel}>{t('btn_cancel')}</Button>
      {/if}
      {#if isDeleting}
        <Button variant="secondary" onclick={pause}>{t('btn_pause')}</Button>
      {/if}
      {#if isPaused}
        <Button variant="primary" onclick={resume}>{t('btn_resume')}</Button>
      {/if}
      {#if isDeleting || isPaused}
        <Button variant="dangerGhost" onclick={cancel}>{t('btn_cancel')}</Button>
      {/if}
  </section>
  <footer class="mt-auto flex flex-col gap-2 bg-surface-strong p-4 rounded-lg rounded-t-none">
    <LogDrawer
      visible={showLogs}
      entries={logs}
      panelId={logPanelId}
      formatTime={formatTime}
      colorForLevel={logColor}
      emptyLabel={t('log_empty')}
      ariaLabel={t('aria_logs_panel')}
    />

    <Button
      variant="secondary"
      compact
      onclick={toggleLogs}
      ariaExpanded={showLogs}
      ariaControls={logPanelId}
      ariaLabel={showLogs ? t('btn_hide_log') : t('btn_show_log')}
      >
      {showLogs ? t('btn_hide_log') : t('btn_show_log')}
    </Button>
    </footer>
</main>
