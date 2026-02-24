<script lang="ts">
  import Card from "./Card.svelte";

  interface ConveyorItem {
    id: string;
    name: string;
    icon: string | null;
    initial: string;
  }

  type ScanStatus = 'done' | 'active' | 'queued';

  interface Props {
    items: ConveyorItem[];
    activeIndex: number;
    progressText: string;
    currentText: string;
    discoveringText: string;
  }

  interface SlotMetrics {
    slot: number;
    scale: number;
    opacity: number;
    hidden: boolean;
  }

  interface RenderConveyorItem extends ConveyorItem {
    status: ScanStatus;
    offset: number;
    slot: number;
    scale: number;
    opacity: number;
    hidden: boolean;
  }

  interface ConnectorSegment {
    id: string;
    startIndex: number;
  offset: number;
    opacity: number;
    isLit: boolean;
  }

  let {
    items = [],
    activeIndex = -1,
    progressText = '',
    currentText = '',
    discoveringText = '',
  }: Props = $props();

  function statusForIndex(index: number, resolvedActive: number): ScanStatus {
    if (resolvedActive < 0) return 'queued';
    if (index < resolvedActive) return 'done';
    if (index === resolvedActive) return 'active';
    return 'queued';
  }

  function metricsForOffset(offset: number): SlotMetrics {
    if (offset <= -3) {
      return { slot: -1, scale: 0, opacity: 0,  hidden: true };
    }
    if (offset >= 3) {
      return { slot: -1, scale: 0, opacity: 0,  hidden: true };
    }

    switch (offset) {
      case -2:
        return { slot: 0, scale: 0.78, opacity: 0.5,  hidden: false };
      case -1:
        return { slot: 1, scale: 0.9, opacity: 0.75,  hidden: false };
      case 0:
        return { slot: 2, scale: 1.2, opacity: 1,  hidden: false };
      case 1:
        return { slot: 3, scale: 0.9, opacity: 0.75,  hidden: false };
      default:
        return { slot: 4, scale: 0.78, opacity: 0.5,  hidden: false };
    }
  }

  const resolvedActiveIndex = $derived.by(() => {
    if (items.length === 0) return -1;
    if (activeIndex < 0) return -1;
    if (activeIndex >= items.length) return items.length - 1;
    return activeIndex;
  });

  const renderItems = $derived.by(() => {
    if (items.length === 0) return [] as RenderConveyorItem[];

    return items.map((item, index) => {
      const offset = resolvedActiveIndex >= 0 ? index - resolvedActiveIndex : index;
      const slot = metricsForOffset(offset);
      return {
        ...item,
        offset,
        status: statusForIndex(index, resolvedActiveIndex),
        slot: slot.slot,
        scale: slot.scale,
        opacity: slot.opacity,
        hidden: slot.hidden,
      };
    });
  });

  const completedCount = $derived.by(() => {
    if (items.length === 0 || resolvedActiveIndex < 0) return 0;
    return Math.max(0, Math.min(resolvedActiveIndex, items.length));
  });

  const progressPercent = $derived.by(() => {
    if (items.length === 0) return 0;
    return Math.round((completedCount / items.length) * 100);
  });

  const effectiveProgressText = $derived(
    progressText || `${Math.min(completedCount + 1, items.length)} / ${items.length}`
  );

  const effectiveCurrentText = $derived.by(() => {
    if (currentText.trim()) return currentText;
    if (resolvedActiveIndex >= 0 && items[resolvedActiveIndex]) {
      return items[resolvedActiveIndex].name;
    }
    return discoveringText;
  });

  const showDiscovering = $derived(items.length === 0 || activeIndex < 0);
  const CONVEYOR_SLOT_STEP_REM = 6.5;
  let lastResolvedActiveIndex = $state(-1);
  let litSegmentStartIndex = $state(-1);

  $effect(() => {
    const current = resolvedActiveIndex;
    if (current < 0) {
      lastResolvedActiveIndex = current;
      litSegmentStartIndex = -1;
      return;
    }

    if (lastResolvedActiveIndex >= 0 && current !== lastResolvedActiveIndex) {
      const movedSegment = Math.min(current, lastResolvedActiveIndex);
      litSegmentStartIndex = movedSegment;
      const timer = setTimeout(() => {
        if (litSegmentStartIndex === movedSegment) {
          litSegmentStartIndex = -1;
        }
      }, 520);
      lastResolvedActiveIndex = current;
      return () => clearTimeout(timer);
    }

    lastResolvedActiveIndex = current;
  });

  const connectorSegments = $derived.by(() => {
    if (items.length < 2 || resolvedActiveIndex < 0) return [] as ConnectorSegment[];

    const start = Math.max(resolvedActiveIndex - 3, 0);
    const end = Math.min(resolvedActiveIndex + 3, items.length - 1);
    const segments: ConnectorSegment[] = [];

    for (let index = start; index < end; index++) {
      const leftSlot = metricsForOffset(index - resolvedActiveIndex);
      const rightSlot = metricsForOffset(index + 1 - resolvedActiveIndex);
      if (leftSlot.hidden || rightSlot.hidden) continue;

      segments.push({
        id: `${index}-${index + 1}`,
        startIndex: index,
        offset: index - resolvedActiveIndex + 0.5,
        opacity: Math.max(0.4, Math.min(leftSlot.opacity, rightSlot.opacity)),
        isLit: index === litSegmentStartIndex,
      });
    }

    return segments;
  });

  function itemStyle(item: RenderConveyorItem): string {
    const filter =
      item.status === 'queued'
        ? 'saturate(0.35) brightness(0.95)'
        : item.status === 'done'
          ? 'saturate(0)'
          : 'none';
    return [
      'grid-column: 1 / span 1',
      'grid-row: 1 / span 1',
      `transform: translateX(calc(${item.offset} * var(--conveyor-step))) scale(${item.scale})`,
      `opacity: ${item.opacity}`,
      `filter: ${filter}`,
    ].join('; ');
  }

  function itemClass(item: RenderConveyorItem): string {
    return `relative flex size-12 items-center justify-center justify-self-center self-center transition-[transform,opacity,filter] duration-[420ms] ease-in-out ${item.hidden ? 'hidden pointer-events-none' : ''}`;
  }

  function avatarClass(status: ScanStatus): string {
    const base =
      'relative flex size-12 items-center justify-center overflow-hidden rounded-full';
    if (status !== 'active') return base;
    return `${base}`;
  }

  function connectorStyle(segment: ConnectorSegment): string {
    return [
      'grid-column: 1 / span 1',
      'grid-row: 1 / span 1',
      `transform: translateX(calc(${segment.offset} * var(--conveyor-step)))`,
      `opacity: ${segment.opacity}`,
    ].join('; ');
  }

  function connectorDotStyle(segment: ConnectorSegment, dotIndex: number): string | undefined {
    if (!segment.isLit) return undefined;
    return `animation: pulse-dot 420ms ease-in-out ${dotIndex * 70}ms 1 both;`;
  }
</script>

<Card>
<section class="flex flex-col gap-2" aria-live="polite">
  {#if showDiscovering}
    <div class="flex items-center gap-2">
    <span class="size-2 rounded-full bg-accent animate-pulse-dot" aria-hidden="true"></span>
    <span>{discoveringText}</span>
  </div>
  {:else}
    <div class="relative overflow-hidden h-full">
      <div
        class="relative z-10 grid h-32 w-full items-center justify-center"
        style={`--conveyor-step: ${CONVEYOR_SLOT_STEP_REM}rem; grid-template-columns: minmax(0, 1fr);`}
      >
        {#each connectorSegments as segment (segment.id)}
          <div
            class="pointer-events-none z-0 flex items-center justify-center gap-1 transition-[transform,opacity] duration-[420ms] ease-in-out"
            style={connectorStyle(segment)}
            aria-hidden="true"
          >
            {#each [0, 1, 2] as dotIndex (dotIndex)}
              <span
                class={`size-1.5 rounded-full ${segment.isLit ? 'bg-accent' : 'bg-accent/35'}`}
                style={connectorDotStyle(segment, dotIndex)}
              ></span>
            {/each}
          </div>
        {/each}

        {#each renderItems as item (item.id)}
          <div class={itemClass(item)} style={itemStyle(item)}>
            <div class={avatarClass(item.status)}>
              {#if item.icon}
                <img src={item.icon} alt="" class={`size-full object-cover bg-black ${item.status === 'done' ? 'blur-[2px]' : ''}`} />
              {:else}
                <span class="font-semibold uppercase tracking-wide text-text-secondary">{item.initial}</span>
              {/if}

              {#if item.status === 'done'}
                <span class="absolute inset-0 flex items-center justify-center text-lg font-semibold text-white" aria-hidden="true">&#10003;</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div
          class="h-full rounded-full bg-gradient-to-r from-accent-hover to-accent transition-[width] duration-300 ease-out"
          style={`width: ${progressPercent}%`}
        ></div>
      </div>

      <div class="flex items-baseline justify-between gap-2">
        <span class="font-mono text-xs text-text-tertiary">{effectiveProgressText}</span>
        <span class="min-w-0 flex-1 truncate text-right text-xs text-text-secondary">{effectiveCurrentText}</span>
      </div>
    </div>
  {/if}
</section>
</Card>
