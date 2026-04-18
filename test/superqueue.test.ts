import {describe, test, expect} from 'bun:test';
import {Superqueue} from '../src';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('basic push/consume', () => {
  test('fromArray yields values in order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    expect(await q.collect()).toEqual([1, 2, 3]);
  });

  test('fromArray auto-ends the queue', () => {
    const q = Superqueue.fromArray([1, 2]);
    expect(q.ended).toBe(true);
  });

  test('async iterator yields each value', async () => {
    const q = Superqueue.fromArray(['a', 'b', 'c']);
    const out: string[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  test('empty ended queue yields nothing', async () => {
    const q = new Superqueue<number>();
    q.end();
    expect(await q.collect()).toEqual([]);
  });

  test('consumer waits for delayed push', async () => {
    const q = new Superqueue<number>();
    const collectProm = q.collect();
    await delay(10);
    q.push(42);
    q.end();
    expect(await collectProm).toEqual([42]);
  });

  test('null is a valid value', async () => {
    const q = Superqueue.fromArray<number | null>([1, null, 2, null]);
    expect(await q.collect()).toEqual([1, null, 2, null]);
  });

  test('objects and symbols pass through', async () => {
    const obj = {x: 1};
    const sym = Symbol('foo');
    const q = Superqueue.fromArray<object | symbol>([obj, sym]);
    expect(await q.collect()).toEqual([obj, sym]);
  });

  test('many pushes preserve order and count', async () => {
    const q = new Superqueue<number>();
    const N = 5000;
    for (let i = 0; i < N; i++) q.push(i);
    q.end();
    const out = await q.collect();
    expect(out.length).toBe(N);
    expect(out[0]).toBe(0);
    expect(out[N - 1]).toBe(N - 1);
  });

  test('interleaved pushes and async consumption', async () => {
    const q = new Superqueue<number>();
    const out: number[] = [];
    const consumer = (async () => {
      for await (const v of q) out.push(v);
    })();
    q.push(1);
    await delay(5);
    q.push(2, 3);
    await delay(5);
    q.end();
    await consumer;
    expect(out).toEqual([1, 2, 3]);
  });
});

describe('size / pushCount', () => {
  test('size tracks pending items', () => {
    const q = new Superqueue<number>();
    expect(q.size()).toBe(0);
    q.push(1, 2, 3);
    expect(q.size()).toBe(3);
  });

  test('size is 0 after consumption', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    await q.collect();
    expect(q.size()).toBe(0);
  });

  test('size stays 0 after end() on empty queue (no sentinel leakage)', () => {
    const q = new Superqueue<number>();
    q.end();
    expect(q.size()).toBe(0);
  });

  test('pushCount counts values, not end', () => {
    const q = new Superqueue<number>();
    q.push(1, 2);
    q.push(3);
    q.end();
    expect(q.pushCount()).toBe(3);
  });
});

describe('errors', () => {
  test('push after end throws', () => {
    const q = new Superqueue<number>();
    q.end();
    expect(() => q.push(1)).toThrow('Superqueue has ended');
  });

  test('end after end throws', () => {
    const q = new Superqueue<number>();
    q.end();
    expect(() => q.end()).toThrow('Superqueue has ended');
  });

  test('double pipe rejects', async () => {
    const q = Superqueue.fromArray([1, 2]);
    await q.collect();
    expect(q.piped).toBe(true);
    await expect(q.collect()).rejects.toThrow('Superqueue already piped');
  });
});

describe('consume', () => {
  test('sync callback invoked for each value in order (no concurrency tracking)', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out: number[] = [];
    await q.consume(v => {
      out.push(v);
    });
    expect(out).toEqual([1, 2, 3]);
  });

  test('sync callback runs regardless of concurrency (not tracked)', async () => {
    const q = Superqueue.fromArray(Array.from({length: 50}, (_, i) => i));
    const seen: number[] = [];
    // concurrency=1, but callback is sync — it never enters the proms array,
    // so the concurrency gate does nothing and all items run in order fast.
    await q.concurrency(1).consume(v => {
      seen.push(v as number);
    });
    expect(seen).toEqual(Array.from({length: 50}, (_, i) => i));
  });

  test('mixed sync/async returns: only promises are tracked', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    let asyncActive = 0;
    let maxAsyncActive = 0;
    const syncOrder: number[] = [];
    await q.concurrency(2).consume(v => {
      if ((v as number) % 2 === 0) {
        // async branch — tracked
        return (async () => {
          asyncActive++;
          maxAsyncActive = Math.max(maxAsyncActive, asyncActive);
          await delay(15);
          asyncActive--;
        })();
      }
      // sync branch — not tracked
      syncOrder.push(v as number);
    });
    expect(maxAsyncActive).toBe(2);
    expect(syncOrder).toEqual([1, 3, 5, 7]);
  });

  test('non-Promise thenable is not awaited (instanceof Promise gate)', async () => {
    // A fake thenable shouldn't get pushed into proms — only real Promises.
    const q = Superqueue.fromArray([1, 2, 3]);
    const seen: number[] = [];
    await q.consume(v => {
      seen.push(v as number);
      return {then: () => {}};
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  test('consume respects concurrency limit', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    let active = 0;
    let maxActive = 0;
    await q.concurrency(3).consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active--;
    });
    expect(maxActive).toBe(3);
  });

  test('concurrency(10) with only 2 items processes all', async () => {
    const q = Superqueue.fromArray([1, 2]);
    const out: number[] = [];
    await q.concurrency(10).consume(async v => {
      out.push(v);
    });
    expect(out.sort()).toEqual([1, 2]);
  });

  test('concurrency(1) is serial and preserves order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out: number[] = [];
    await q.concurrency(1).consume(async v => {
      await delay((4 - v) * 5);
      out.push(v);
    });
    expect(out).toEqual([1, 2, 3]);
  });

  test('consume processes every item under concurrency > 1 (order not guaranteed)', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out: number[] = [];
    await q.concurrency(3).consume(async v => {
      await delay(Math.random() * 10);
      out.push(v);
    });
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('concurrency() can be called before piping (fluent setup)', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6]);
    let active = 0;
    let maxActive = 0;
    await q.concurrency(2).consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBe(2);
  });

  test('concurrency can be raised mid-run from the callback', async () => {
    const N = 40;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    let active = 0;
    const activeHistory: number[] = [];
    await q.concurrency(2).consume(async v => {
      if (v === 10) q.concurrency(8);
      active++;
      activeHistory.push(active);
      await delay(5);
      active--;
    });
    const maxEarly = Math.max(...activeHistory.slice(0, 5));
    const maxLate = Math.max(...activeHistory.slice(-10));
    expect(maxEarly).toBeLessThanOrEqual(2);
    expect(maxLate).toBeGreaterThan(2);
  });

  test('concurrency can be lowered mid-run and drains down', async () => {
    const N = 40;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    let active = 0;
    const activeHistory: number[] = [];
    await q.concurrency(10).consume(async v => {
      if (v === 5) q.concurrency(2);
      active++;
      activeHistory.push(active);
      await delay(10);
      active--;
    });
    const tail = activeHistory.slice(-15);
    expect(Math.max(...tail)).toBeLessThanOrEqual(2);
  });

  test('concurrency(0) clamps to 1 (no deadlock)', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out: number[] = [];
    await q.concurrency(0).consume(async v => {
      out.push(v);
    });
    expect(out.sort()).toEqual([1, 2, 3]);
  });

  test('upipe respects pre-pipe concurrency', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = q.concurrency(1).upipe(async v => {
      await delay(3);
      return v * 10;
    });
    const values = await out.collect();
    expect(values.sort((a, b) => a - b)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80,
    ]);
  });

  test('concurrency(Infinity) dispatches all items concurrently', async () => {
    const N = 10;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    let active = 0;
    let maxActive = 0;
    await q.concurrency(Infinity).consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active--;
    });
    expect(maxActive).toBe(N);
  });

  test('concurrency(NaN) falls back to serial (does not unbound)', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    let active = 0;
    let maxActive = 0;
    await q.concurrency(NaN).consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBe(1);
  });

  test('concurrency(2.9) admits up to ceil', async () => {
    const q = Superqueue.fromArray(Array.from({length: 10}, (_, i) => i));
    let active = 0;
    let maxActive = 0;
    await q.concurrency(2.9).consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBe(3);
  });

  test('oscillating concurrency from the callback does not deadlock', async () => {
    const N = 20;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    const out: number[] = [];
    let tick = 0;
    await q.concurrency(1).consume(async v => {
      q.concurrency(tick++ % 2 === 0 ? 1 : 4);
      await delay(2);
      out.push(v);
    });
    expect(out.sort((a, b) => a - b)).toEqual(
      Array.from({length: N}, (_, i) => i),
    );
  });

  test('usplit respects pre-pipe concurrency', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6]);
    const [evens, odds] = q.concurrency(2).usplit<number>(async v => {
      await delay(3);
      return v % 2 === 0 ? [v, 0] : [v, 1];
    });
    const [e, o] = await Promise.all([evens.collect(), odds.collect()]);
    expect(e.sort((a, b) => a - b)).toEqual([2, 4, 6]);
    expect(o.sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });
});

describe('pipe', () => {
  test('transforms each value', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out = q.pipe(v => v * 2);
    expect(await out.collect()).toEqual([2, 4, 6]);
  });

  test('undefined return filters the value', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const out = q.pipe(v => (v % 2 === 0 ? v : undefined));
    expect(await out.collect()).toEqual([2, 4]);
  });

  test('chained pipes compose', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const out = q.pipe(v => v * 2).pipe(v => v + 1);
    expect(await out.collect()).toEqual([3, 5, 7, 9]);
  });

  test('pipe result ends after source ends', async () => {
    const q = Superqueue.fromArray([1]);
    const out = q.pipe(v => v);
    await out.collect();
    expect(out.ended).toBe(true);
  });
});

describe('upipe', () => {
  test('async transform', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out = q.upipe(async v => v * 2);
    const values = await out.collect();
    expect(values.sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  test('undefined return filters', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const out = q.upipe(async v => (v > 2 ? v : undefined));
    const values = await out.collect();
    expect(values.sort((a, b) => a - b)).toEqual([3, 4]);
  });

  test('concurrency(Infinity) upipe dispatches all concurrently and gathers before ending', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const start = Date.now();
    const out = q.concurrency(Infinity).upipe(async v => {
      await delay(30);
      return v;
    });
    const values = await out.collect();
    const elapsed = Date.now() - start;
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(elapsed).toBeLessThan(70);
  });

  test('concurrency(1) upipe preserves order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out = q.concurrency(1).upipe(async v => {
      await delay((4 - v) * 5);
      return v;
    });
    expect(await out.collect()).toEqual([1, 2, 3]);
  });

  test('bounded concurrency waits for trailing in-flight callbacks before ending', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out = q.concurrency(2).upipe(async v => {
      await delay(v >= 4 ? 50 : 2);
      return v;
    });
    const values = await out.collect();
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('last-item slow: every push lands even when final callback is slowest', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const out = q.concurrency(3).upipe(async v => {
      await delay(v === 10 ? 80 : 5);
      return v;
    });
    const values = await out.collect();
    expect(values.length).toBe(10);
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('upipe output queue does not end while callbacks are in flight', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const out = q.concurrency(2).upipe(async v => {
      await delay(20);
      return v;
    });
    const seen: number[] = [];
    for await (const v of out) {
      seen.push(v);
      if (seen.length < 4) expect(out.ended).toBe(false);
    }
    expect(out.ended).toBe(true);
    expect(seen.length).toBe(4);
  });

  test('concurrency(Infinity) upipe with slow last item: every push lands', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const out = q.concurrency(Infinity).upipe(async v => {
      await delay(v === 10 ? 80 : 5);
      return v;
    });
    const values = await out.collect();
    expect(values.length).toBe(10);
    expect(values.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test('concurrency(Infinity) upipe with heterogeneous delays stays open until last push', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out = q.concurrency(Infinity).upipe(async v => {
      await delay(v * 15);
      return v;
    });
    const seen: number[] = [];
    for await (const v of out) {
      seen.push(v);
      if (seen.length < 5) expect(out.ended).toBe(false);
    }
    expect(out.ended).toBe(true);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('concurrency(Infinity) upipe under high fan-out: no pushes dropped', async () => {
    const N = 200;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    const out = q.concurrency(Infinity).upipe(async v => {
      await delay(Math.random() * 20);
      return v;
    });
    const values = await out.collect();
    expect(values.length).toBe(N);
    expect(values.sort((a, b) => a - b)).toEqual(
      Array.from({length: N}, (_, i) => i),
    );
  });
});

describe('split / usplit', () => {
  test('split routes values by index', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const [even, odd] = q.split<number>(v =>
      v % 2 === 0 ? [v, 0] : [v, 1],
    );
    const [e, o] = await Promise.all([even.collect(), odd.collect()]);
    expect(e).toEqual([2, 4]);
    expect(o).toEqual([1, 3, 5]);
  });

  test('split supports different output types', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const [strs, nums] = q.split<string, number>(v =>
      v === 2 ? [v, 1] : [`v${v}`, 0],
    );
    const [s, n] = await Promise.all([strs.collect(), nums.collect()]);
    expect(s).toEqual(['v1', 'v3']);
    expect(n).toEqual([2]);
  });

  test('usplit async routing with filtering', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const [left, right] = q.usplit<number>(async v => {
      if (v === 2) return undefined;
      return v % 2 === 0 ? [v, 0] : [v, 1];
    });
    const [l, r] = await Promise.all([left.collect(), right.collect()]);
    expect(l.sort()).toEqual([4]);
    expect(r.sort()).toEqual([1, 3]);
  });
});

describe('batch', () => {
  test('exact multiples', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    expect(await q.batch(2).collect()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('flushes remainder on end', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    expect(await q.batch(2).collect()).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('batch size 1', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    expect(await q.batch(1).collect()).toEqual([[1], [2], [3]]);
  });

  test('batch size larger than input', async () => {
    const q = Superqueue.fromArray([1, 2]);
    expect(await q.batch(5).collect()).toEqual([[1, 2]]);
  });

  test('empty queue produces no batches', async () => {
    const q = new Superqueue<number>();
    q.end();
    expect(await q.batch(3).collect()).toEqual([]);
  });
});

describe('flat', () => {
  test('flattens nested arrays', async () => {
    const q = Superqueue.fromArray([
      [1, 2],
      [3],
      [4, 5, 6],
    ]);
    expect(await q.flat().collect()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('empty sub-arrays are skipped', async () => {
    const q = Superqueue.fromArray<number[]>([[1], [], [2, 3], []]);
    expect(await q.flat().collect()).toEqual([1, 2, 3]);
  });

  test('batch then flat is identity', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    expect(await q.batch(2).flat().collect()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('clone', () => {
  test('default count is 2 and both receive all values', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const [a, b] = q.clone();
    const results = await Promise.all([a.collect(), b.collect()]);
    expect(results).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  test('count=3 produces 3 identical queues', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const [a, b, c] = q.clone(3);
    const results = await Promise.all([a.collect(), b.collect(), c.collect()]);
    expect(results).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  test('count=1 works (pass-through)', async () => {
    const q = Superqueue.fromArray([1, 2]);
    const [a] = q.clone(1);
    expect(await a.collect()).toEqual([1, 2]);
  });

  test('count=0 throws', () => {
    const q = Superqueue.fromArray([1]);
    expect(() => q.clone(0)).toThrow('Count must be at least 1');
  });

  test('clones work when consumed sequentially', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const [a, b] = q.clone(2);
    const aResult = await a.collect();
    const bResult = await b.collect();
    expect(aResult).toEqual([1, 2, 3]);
    expect(bResult).toEqual([1, 2, 3]);
  });

  test('clones inherit source concurrency', async () => {
    const N = 12;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    q.concurrency(2);
    const [a, b] = q.clone(2);

    let activeA = 0;
    let maxA = 0;
    let activeB = 0;
    let maxB = 0;
    await Promise.all([
      a.consume(async () => {
        activeA++;
        maxA = Math.max(maxA, activeA);
        await delay(5);
        activeA--;
      }),
      b.consume(async () => {
        activeB++;
        maxB = Math.max(maxB, activeB);
        await delay(5);
        activeB--;
      }),
    ]);
    expect(maxA).toBe(2);
    expect(maxB).toBe(2);
  });

  test('clones inherit Infinity concurrency', async () => {
    const N = 6;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    q.concurrency(Infinity);
    const [a] = q.clone(1);

    let active = 0;
    let maxActive = 0;
    await a.consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(15);
      active--;
    });
    expect(maxActive).toBe(N);
  });

  test('changes to source concurrency after clone() do not retroactively affect clones', async () => {
    // Inheritance happens at clone-time — each clone gets its own copy.
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6]);
    q.concurrency(1);
    const [a] = q.clone(1);
    // Mutate source after cloning.
    q.concurrency(10);

    let active = 0;
    let maxActive = 0;
    await a.consume(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBe(1);
  });
});

describe('umerge', () => {
  test('combines values from two queues', async () => {
    const a = Superqueue.fromArray([1, 2]);
    const b = Superqueue.fromArray([3, 4]);
    const merged = await a.umerge(b).collect();
    expect(merged.sort()).toEqual([1, 2, 3, 4]);
  });

  test('handles one empty queue', async () => {
    const a = Superqueue.fromArray([1, 2]);
    const b = new Superqueue<number>();
    b.end();
    const merged = await a.umerge(b).collect();
    expect(merged.sort()).toEqual([1, 2]);
  });

  test('handles both empty queues', async () => {
    const a = new Superqueue<number>();
    const b = new Superqueue<number>();
    a.end();
    b.end();
    expect(await a.umerge(b).collect()).toEqual([]);
  });
});

describe('waitForShift / waitForEnd', () => {
  test('waitForEnd resolves when end() is called', async () => {
    const q = new Superqueue<number>();
    let ended = false;
    const p = q.waitForEnd().then(() => {
      ended = true;
    });
    await delay(5);
    expect(ended).toBe(false);
    q.end();
    await p;
    expect(ended).toBe(true);
  });

  test('waitForShift resolves after an item is consumed', async () => {
    const q = Superqueue.fromArray([1, 2]);
    let shifts = 0;
    const watch = (async () => {
      while (!q.ended || q.size() > 0) {
        await q.waitForShift();
        shifts++;
      }
    })();
    await q.collect();
    await Promise.race([watch, delay(50)]);
    expect(shifts).toBeGreaterThanOrEqual(1);
  });
});

describe('EOF sentinel', () => {
  test('static EOF is a symbol', () => {
    expect(typeof Superqueue.EOF).toBe('symbol');
  });

  test('EOF is distinct from any user-constructible value', () => {
    // Users can construct symbols but not this one
    expect(Symbol('Superqueue.EOF')).not.toBe(Superqueue.EOF);
  });

  test('shiftUnsafe returns EOF after draining an ended queue', async () => {
    const q = new Superqueue<number>();
    q.push(1);
    q.end();
    expect(await q.shiftUnsafe()).toBe(1);
    expect(await q.shiftUnsafe()).toBe(Superqueue.EOF);
    expect(await q.shiftUnsafe()).toBe(Superqueue.EOF);
  });

  test('end() wakes a shift that is already awaiting on empty queue', async () => {
    const q = new Superqueue<number>();
    const shiftProm = q.shiftUnsafe();
    await delay(10);
    q.end();
    expect(await shiftProm).toBe(Superqueue.EOF);
  });

  test('end() wakes multiple concurrent waiters', async () => {
    const q = new Superqueue<number>();
    const a = q.shiftUnsafe();
    const b = q.shiftUnsafe();
    const c = q.shiftUnsafe();
    await delay(10);
    q.end();
    expect(await Promise.all([a, b, c])).toEqual([
      Superqueue.EOF,
      Superqueue.EOF,
      Superqueue.EOF,
    ]);
  });

  test('end() after partial consumption resolves pending shift with EOF', async () => {
    const q = new Superqueue<number>();
    q.push(1);
    expect(await q.shiftUnsafe()).toBe(1);
    const pending = q.shiftUnsafe();
    await delay(5);
    q.end();
    expect(await pending).toBe(Superqueue.EOF);
  });

  test('undefined is a legal value type (EOF is no longer undefined)', async () => {
    const q = new Superqueue<number | undefined>();
    q.push(1);
    q.push(undefined);
    q.push(2);
    q.end();
    expect(await q.collect()).toEqual([1, undefined, 2]);
  });
});

describe('pause / resume', () => {
  test('pause() blocks shift until resume()', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    q.pause();
    let resolved = false;
    const shiftProm = q.shiftUnsafe().then(v => {
      resolved = true;
      return v;
    });
    await delay(20);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(1);
  });

  test('pause mid-iteration stops consumption; resume continues it', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const v of q) {
        seen.push(v);
        if (v === 2) q.pause();
      }
    })();
    await delay(30);
    expect(seen).toEqual([1, 2]);
    expect(q.paused).toBe(true);
    q.resume();
    await consumer;
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  test('pause inside consume callback pauses further shifts', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6]);
    const seen: number[] = [];
    let pausedAt: number | null = null;
    const runProm = q.concurrency(2).consume(async v => {
      seen.push(v);
      if (v === 3 && pausedAt === null) {
        pausedAt = seen.length;
        q.pause();
        await delay(30);
        q.resume();
      }
    });
    await runProm;
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pausedAt).toBeGreaterThan(0);
  });

  test('pause before any push: shift blocks until resume', async () => {
    const q = new Superqueue<number>();
    q.pause();
    let resolved = false;
    const shiftProm = q.shiftUnsafe().then(v => {
      resolved = true;
      return v;
    });
    q.push(42);
    q.end();
    await delay(20);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(42);
  });

  test('pause then end: shift still blocks until resume, then yields EOF', async () => {
    const q = new Superqueue<number>();
    q.pause();
    q.end();
    let resolved = false;
    const shiftProm = q.shiftUnsafe().then(v => {
      resolved = true;
      return v;
    });
    await delay(20);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(Superqueue.EOF);
  });

  test('multiple pause/resume cycles', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const v of q) seen.push(v);
    })();
    await delay(5);
    q.pause();
    await delay(10);
    q.resume();
    await delay(5);
    q.pause();
    await delay(10);
    q.resume();
    await consumer;
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  test('pause() and resume() are idempotent', async () => {
    const q = Superqueue.fromArray([1]);
    q.pause();
    q.pause();
    q.pause();
    expect(q.paused).toBe(true);
    q.resume();
    q.resume();
    expect(q.paused).toBe(false);
    expect(await q.collect()).toEqual([1]);
  });

  test('pause only gates consumption, not production', () => {
    const q = new Superqueue<number>();
    q.pause();
    // push and end must still work while paused
    q.push(1, 2);
    expect(q.size()).toBe(2);
    q.end();
    expect(q.ended).toBe(true);
  });

  test('pause blocks even with items already queued', async () => {
    const q = new Superqueue<number>();
    q.push(1, 2, 3);
    q.end();
    q.pause();
    let resolved = false;
    const collectProm = q.collect().then(v => {
      resolved = true;
      return v;
    });
    await delay(20);
    expect(resolved).toBe(false);
    q.resume();
    expect(await collectProm).toEqual([1, 2, 3]);
  });

  test('single resume releases multiple concurrent shifts', async () => {
    const q = new Superqueue<number>();
    q.push(1, 2, 3);
    q.pause();
    const shifts = [q.shiftUnsafe(), q.shiftUnsafe(), q.shiftUnsafe()];
    await delay(15);
    q.resume();
    const values = await Promise.all(shifts);
    expect(values.sort()).toEqual([1, 2, 3]);
  });

  test('pause between empty-wait and push: shift still gates on pause', async () => {
    const q = new Superqueue<number>();
    // Consumer starts while queue is empty — parks in waitForPush.
    let resolved = false;
    const shiftProm = q.shiftUnsafe().then(v => {
      resolved = true;
      return v;
    });
    await delay(5);
    q.pause();
    // Push wakes waitForPush; but shift must re-check paused and gate.
    q.push(42);
    await delay(20);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(42);
  });

  test('pause propagates through pipe: downstream stops receiving', async () => {
    const src = Superqueue.fromArray([1, 2, 3, 4]);
    src.pause();
    const out = src.pipe(v => v * 2);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const v of out) seen.push(v);
    })();
    await delay(20);
    expect(seen).toEqual([]);
    expect(out.ended).toBe(false);
    src.resume();
    await consumer;
    expect(seen).toEqual([2, 4, 6, 8]);
  });

  test('pause applied after pipe starts: at most one in-flight value leaks', async () => {
    // pipe() synchronously fires the first #shift() whose body can complete
    // without awaiting (paused=false, size>0). Subsequent shifts will gate.
    const src = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out = src.pipe(v => v);
    src.pause();
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const v of out) seen.push(v);
    })();
    await delay(20);
    expect(seen.length).toBeLessThanOrEqual(1);
    expect(out.ended).toBe(false);
    src.resume();
    await consumer;
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  test('pause from sync pipe callback halts subsequent source reads', async () => {
    const src = Superqueue.fromArray([1, 2, 3, 4]);
    const seen: number[] = [];
    const out = src.pipe(v => {
      seen.push(v);
      if (v === 2) src.pause();
      return v;
    });
    const collectProm = out.collect();
    await delay(30);
    expect(seen).toEqual([1, 2]);
    src.resume();
    expect(await collectProm).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  test('rapid pause/resume cycles during an awaiting shift', async () => {
    const q = new Superqueue<number>();
    q.pause();
    const shiftProm = q.shiftUnsafe();
    // Rapidly toggle pause/resume before any push — shift must remain
    // gated and deliver only after resume + push.
    q.resume();
    q.pause();
    q.resume();
    q.pause();
    await delay(10);
    q.push(7);
    await delay(10);
    // Still paused — push happened but shift should not have resolved.
    let resolved = false;
    shiftProm.then(() => {
      resolved = true;
    });
    await delay(10);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(7);
  });

  test('pause does not resolve while paused even with intervening pushes and end', async () => {
    const q = new Superqueue<number>();
    q.pause();
    let resolved = false;
    const shiftProm = q.shiftUnsafe().then(v => {
      resolved = true;
      return v;
    });
    q.push(1);
    q.push(2);
    q.end();
    await delay(30);
    expect(resolved).toBe(false);
    q.resume();
    expect(await shiftProm).toBe(1);
  });
});
