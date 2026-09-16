import { describe, expect, test } from "bun:test";
import { dispatchBounded, FifoLimiter } from "../src/push/concurrency.ts";
import { PushActivity } from "../src/push/inference-status.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("bounded push scheduling", () => {
  test("FIFO waits cancel without leaking permits, including cancellation after a grant", async () => {
    const limiter = new FifoLimiter(1);
    const signal = new AbortController().signal;
    const release = await limiter.acquire(signal);
    const canceled = new AbortController();
    const waiting = limiter.acquire(canceled.signal).catch((error: unknown) => error);
    const order: number[] = [];
    const second = limiter.acquire(signal).then((free) => {
      order.push(2);
      return free;
    });
    const third = limiter.acquire(signal).then((free) => {
      order.push(3);
      return free;
    });
    canceled.abort();
    expect(await waiting).toBeDefined();
    release();
    const freeSecond = await second;
    expect(order).toEqual([2]);
    release(); // Releasing twice cannot create an extra slot.
    await tick();
    expect(order).toEqual([2]);
    freeSecond();
    (await third)();
    const acquired = new AbortController();
    const permit = limiter.acquire(acquired.signal);
    acquired.abort();
    (await permit)();
    (await limiter.acquire(signal))();
    await expect(limiter.acquire(canceled.signal)).rejects.toBeDefined();
  });

  test("reserves buffer capacity before advancing a lazy iterator and drains on source errors", async () => {
    const gates = [deferred(), deferred()];
    let reads = 0;
    let finished = 0;
    let closed = false;
    const errors: unknown[] = [];
    async function* source() {
      try {
        reads++;
        yield 0;
        reads++;
        yield 1;
        reads++;
        throw new Error("source failed");
      } finally {
        closed = true;
      }
    }
    const run = dispatchBounded(
      source(),
      2,
      () => true,
      async (i) => {
        await gates[i]!.promise;
        finished++;
      },
      (error) => errors.push(error),
    );
    await tick();
    expect(reads).toBe(2);
    gates[1]!.resolve();
    await tick();
    expect(errors).toHaveLength(1);
    expect(closed).toBe(true);
    expect(finished).toBe(1);
    gates[0]!.resolve();
    await run;
    expect(finished).toBe(2);
  });

  test("worker failures stop new work and await the sibling", async () => {
    const gate = deferred();
    const fail = deferred();
    const started: number[] = [];
    let settled = false;
    async function* source() {
      for (let i = 0; i < 5; i++) yield i;
    }
    const run = dispatchBounded(
      source(),
      2,
      () => true,
      async (i) => {
        started.push(i);
        if (i === 0) {
          await fail.promise;
          throw new Error("worker failed");
        }
        await gate.promise;
        settled = true;
      },
      () => {},
    );
    await tick();
    fail.resolve();
    await tick();
    expect(started).toEqual([0, 1]);
    expect(settled).toBe(false);
    gate.resolve();
    await run;
    expect(settled).toBe(true);
  });

  test("finishing one batch preserves sibling activity", () => {
    const activity = new PushActivity();
    activity.startBatch("op", 1, ["a", "b"]);
    activity.startBatch("op", 2, ["c"]);
    activity.finishBatch("op", 1);
    expect([...activity.calls.get("op")!]).toEqual(["c"]);
    activity.finishOperation("op");
    expect(activity.calls.has("op")).toBe(false);
  });
});
