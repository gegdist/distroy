<script lang="ts">
  interface Props {
    connected: boolean;
    connectedLabel: string;
    disconnectedLabel: string;
    connectedAriaLabel: string;
    disconnectedAriaLabel: string;
    tooltip?: string;
  }

  let {
    connected,
    connectedLabel,
    disconnectedLabel,
    connectedAriaLabel,
    disconnectedAriaLabel,
    tooltip = '',
  }: Props = $props();
</script>

<div
  class="flex items-center gap-2 text-xs font-medium bg-white/3 py-1 px-2 rounded-full {connected ? 'text-success' : 'text-text-tertiary'}"
  role="status"
  aria-label={connected ? connectedAriaLabel : disconnectedAriaLabel}
  title={connected && tooltip ? tooltip : undefined}
>
  <span class="w-2 h-2 rounded-full shrink-0 bg-current {connected ? 'shadow-status-success' : ''}"></span>
  <span>{connected ? connectedLabel : disconnectedLabel}</span>
</div>
