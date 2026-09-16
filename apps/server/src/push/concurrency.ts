/** Small process-local FIFO. A permit covers one logical connector call, including its retries. */
export class FifoLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit: number) {
    assertConcurrency(limit);
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(grant);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      const grant = () => {
        signal.removeEventListener("abort", abort);
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (signal.aborted) return abort();
      if (this.active < this.limit) grant();
      else {
        this.waiting.push(grant);
        signal.addEventListener("abort", abort, { once: true });
      }
    });
  }
}

export interface PushConcurrency {
  batchesPerOperation?: number;
  sharedCalls?: FifoLimiter;
}

export const sharedPushCalls = new FifoLimiter(4);

export function assertConcurrency(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Push concurrency must be a positive integer");
}

/** Reserve capacity BEFORE next(): image preparation must be bounded too. Always drain workers. */
export async function dispatchBounded<T>(
  source: AsyncIterable<T>,
  concurrency: number,
  canSchedule: () => boolean,
  run: (value: T) => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  assertConcurrency(concurrency);
  const iterator = source[Symbol.asyncIterator]();
  const active = new Set<Promise<void>>();
  let failed = false;
  const fail = (error: unknown) => {
    failed = true;
    onError(error);
  };
  try {
    while (!failed && canSchedule()) {
      if (active.size >= concurrency) {
        await Promise.race(active);
        continue;
      }
      const next = await iterator.next();
      if (next.done || failed || !canSchedule()) break;
      const work = run(next.value).catch(fail);
      active.add(work);
      void work.then(() => active.delete(work));
    }
  } catch (error) {
    fail(error);
  } finally {
    try {
      await iterator.return?.();
    } catch (error) {
      fail(error);
    }
    await Promise.allSettled(active);
  }
}
