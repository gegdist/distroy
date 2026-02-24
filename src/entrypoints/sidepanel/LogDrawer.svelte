<script lang="ts">
  import { type LogEntry, type LogLevel } from '@/lib/messaging/protocol';

  interface Props {
    visible: boolean;
    entries: LogEntry[];
    panelId: string;
    formatTime: (timestamp: number) => string;
    colorForLevel: (level: LogLevel) => string;
    emptyLabel: string;
    ariaLabel: string;
  }

  let {
    visible,
    entries,
    panelId,
    formatTime,
    colorForLevel,
    emptyLabel,
    ariaLabel,
  }: Props = $props();

  let container: HTMLElement | undefined = $state();

  $effect(() => {
    if (visible && entries.length > 0 && container) {
      container.scrollTop = container.scrollHeight;
    }
  });
</script>

{#if visible}
  <section
    id={panelId}
    class="flex-1 min-h-24 max-h-80 overflow-y-auto bg-surface rounded-xl p-2 text-xs"
    aria-label={ariaLabel}
    aria-live="polite"
    bind:this={container}
  >
      {#if entries.length === 0}
        <p class="text-text-tertiary">{emptyLabel}</p>
      {/if}
      {#each entries as entry}
        <div class="flex gap-2" style="color: {colorForLevel(entry.level)}">
          <span class="shrink-0 opacity-60 text-text-tertiary">{formatTime(entry.timestamp)}</span>
          <span>{entry.message}</span>
        </div>
      {/each}
  </section>
{/if}
