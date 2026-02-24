<script lang="ts">
  interface Props {
    value?: number;
    active?: boolean;
  }

  let { value = 0, active = false }: Props = $props();

  const clamped = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="h-1 bg-surface-strong rounded-sm overflow-hidden relative">
  <div class="h-full bg-accent rounded-sm transition-[width] duration-300 ease-in-out {active ? 'animate-pulse-glow' : ''}" style="width: {clamped}%"></div>
</div>
