<script lang="ts">
  import type { Snippet } from 'svelte';

  type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerGhost' | 'link';

  interface Props {
    id?: string;
    variant?: ButtonVariant;
    disabled?: boolean;
    onclick?: () => void;
    fullWidth?: boolean;
    compact?: boolean;
    ariaExpanded?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
    children?: Snippet;
  }

  let {
    id = undefined,
    variant = 'secondary',
    disabled = false,
    onclick = undefined,
    fullWidth = false,
    compact = false,
    ariaExpanded = undefined,
    ariaControls = undefined,
    ariaLabel = undefined,
    children,
  }: Props = $props();

  const solidBase =
    'rounded-lg cursor-pointer transition-all duration-200 disabled:opacity-35 disabled:cursor-not-allowed text-xs font-medium tracking-wide';
  const linkBase =
    'bg-transparent border-none cursor-pointer text-accent hover:underline disabled:opacity-35 disabled:cursor-not-allowed text-xs';

  const sizeClass = $derived(compact ? 'p-2' : 'px-5 py-2');
  const variantClass = $derived.by(() => {
    switch (variant) {
      case 'primary':
        return 'bg-accent text-white hover:bg-accent-hover hover:shadow-lg';
      case 'danger':
        return 'bg-danger text-white hover:bg-danger-hover hover:shadow-lg';
      case 'dangerGhost':
        return 'bg-danger-dim text-danger border border-danger-border-strong hover:bg-danger-border-strong';
      case 'secondary':
        return 'bg-surface text-text-secondary border border-surface-strong hover:bg-surface-strong hover:text-text';
      default:
        return '';
    }
  });

  const classes = $derived.by(() => {
    if (variant === 'link') {
      return linkBase;
    }
    return [
      solidBase,
      sizeClass,
      variantClass,
      fullWidth ? 'w-full' : '',
    ]
      .join(' ')
      .trim();
  });
</script>

<button
  {id}
  type="button"
  class={classes}
  {disabled}
  {onclick}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}
  aria-label={ariaLabel}
>
  {@render children?.()}
</button>
