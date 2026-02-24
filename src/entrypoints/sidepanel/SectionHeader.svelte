<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    right?: Snippet;
  }

  let { label, right }: Props = $props();
</script>

<div class="flex justify-between items-center">
  <span class="text-xs font-medium text-text-secondary">{label}</span>
  {@render right?.()}
</div>
