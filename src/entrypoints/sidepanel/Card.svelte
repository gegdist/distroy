<script lang="ts">
  import type { Snippet } from 'svelte';

  type CardVariant = 'default' | 'danger' | 'success';

  interface Props {
    variant?: CardVariant;
    children?: Snippet;
  }

  let { variant = 'default', children }: Props = $props();

  const borderClass = $derived.by(() => {
    switch (variant) {
      case 'danger':
        return 'border-danger-border-strong bg-danger-dim';
      case 'success':
        return 'border-success-border bg-success-dim';
      default:
        return 'border-surface-strong bg-surface';
    }
  });

  const classes = $derived(
    `border rounded-lg m-2 p-3 flex flex-col gap-2 ${borderClass}`
  );
</script>

<section class={classes}>
  {@render children?.()}
</section>
