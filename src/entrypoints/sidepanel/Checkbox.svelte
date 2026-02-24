<script lang="ts">
  interface Props {
    checked: boolean;
    onchange: () => void;
    ariaLabel?: string;
  }

  let { checked, onchange, ariaLabel = '' }: Props = $props();

  const boxClass = $derived(
    `size-4 rounded border flex items-center justify-center transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2 ${
      checked ? 'border-accent bg-accent' : 'border-surface-strong bg-surface'
    }`
  );

  const markClass = $derived(
    `size-3 text-white transition-all duration-150 ${
      checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
    }`
  );
</script>

<span class="relative shrink-0 size-4">
  <input
    type="checkbox"
    class="peer absolute inset-0 m-0 size-4 opacity-0 cursor-pointer"
    {checked}
    {onchange}
    aria-label={ariaLabel}
  />
  <span class={boxClass} aria-hidden="true">
    <svg class={markClass} viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5L6.5 11.5L12.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</span>
