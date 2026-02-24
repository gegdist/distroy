<script lang="ts">
  import Checkbox from './Checkbox.svelte';

  interface Props {
    name: string;
    count: number;
    checked: boolean;
    icon?: string | null;
    initial?: string;
    onchange: () => void;
  }

  let { name, count, checked, icon = null, initial = '', onchange }: Props = $props();
</script>

<label class="flex items-center gap-2 cursor-pointer p-2 rounded-md transition-colors duration-150 hover:bg-surface">
  <Checkbox {checked} {onchange} ariaLabel={name} />
  {#if icon}
    <img class="size-6 rounded-md object-cover shrink-0" src={icon} alt="" />
  {:else if initial}
    <span class="size-6 rounded-md bg-surface-strong flex items-center justify-center shrink-0 text-xs font-medium text-text-tertiary">{initial}</span>
  {/if}
  <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-text-secondary">{name}</span>
  <span class="shrink-0 text-xs tabular-nums text-text-tertiary">{count.toLocaleString()}</span>
</label>
