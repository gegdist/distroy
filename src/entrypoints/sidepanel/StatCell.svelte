<script lang="ts">
  interface Props {
    value: string;
    label: string;
    color?: string;
  }

  let { value, label, color = 'var(--color-text)' }: Props = $props();
</script>

<div class="flex flex-col gap-1 py-2 text-center rounded-md bg-surface overflow-hidden">
  <span class="text-sm font-medium" style="color: {color}">{value}</span>
  <span class="overflow-hidden text-ellipsis whitespace-nowrap px-1 text-2xs font-medium uppercase text-text-tertiary" title={label}>{label}</span>
</div>
