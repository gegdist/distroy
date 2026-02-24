export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    const onAbort = () => {
      clearTimeout(timer);
      done();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
