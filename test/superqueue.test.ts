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

describe('map / mapParallel', () => {
  test('map invokes callback for each value in order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out: number[] = [];
    await q.map(v => {
      out.push(v);
    });
    expect(out).toEqual([1, 2, 3]);
  });

  test('mapParallel respects concurrency limit', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    let active = 0;
    let maxActive = 0;
    await q.mapParallel(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active--;
    }, 3);
    expect(maxActive).toBe(3);
  });

  test('mapParallel with limit > items still processes all', async () => {
    const q = Superqueue.fromArray([1, 2]);
    const out: number[] = [];
    await q.mapParallel(async v => {
      out.push(v);
    }, 10);
    expect(out.sort()).toEqual([1, 2]);
  });

  test('mapParallel n=1 is serial and preserves order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out: number[] = [];
    await q.mapParallel(async v => {
      await delay((4 - v) * 5);
      out.push(v);
    }, 1);
    expect(out).toEqual([1, 2, 3]);
  });

  test('mapParallel processes every item when n > 1 (order not guaranteed)', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out: number[] = [];
    await q.mapParallel(async v => {
      await delay(Math.random() * 10);
      out.push(v);
    }, 3);
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
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

  test('n=Infinity dispatches all concurrently and gathers before ending', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const start = Date.now();
    const out = q.upipe(async v => {
      await delay(30);
      return v;
    }, Infinity);
    const values = await out.collect();
    const elapsed = Date.now() - start;
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // All three ran in parallel: should be ~30ms, not 90ms.
    expect(elapsed).toBeLessThan(70);
  });

  test('n=1 preserves order', async () => {
    const q = Superqueue.fromArray([1, 2, 3]);
    const out = q.upipe(async v => {
      await delay((4 - v) * 5);
      return v;
    }, 1);
    expect(await out.collect()).toEqual([1, 2, 3]);
  });

  test('bounded n waits for trailing in-flight callbacks before ending', async () => {
    // With n=2, after shift yields EOF the last two items are still in flight.
    // Make them much slower than the earlier ones to catch any premature end.
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out = q.upipe(async v => {
      await delay(v >= 4 ? 50 : 2);
      return v;
    }, 2);
    const values = await out.collect();
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('last-item slow: every push lands even when final callback is slowest', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const out = q.upipe(async v => {
      // The 10th item takes longer than any other — if end fires before
      // its push, we'd see 9 items not 10.
      await delay(v === 10 ? 80 : 5);
      return v;
    }, 3);
    const values = await out.collect();
    expect(values.length).toBe(10);
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('upipe output queue does not end while callbacks are in flight', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4]);
    const out = q.upipe(async v => {
      await delay(20);
      return v;
    }, 2);
    // Poll: while any items are still coming in, the output queue must not
    // be marked ended until all 4 pushes have happened.
    const seen: number[] = [];
    for await (const v of out) {
      seen.push(v);
      if (seen.length < 4) expect(out.ended).toBe(false);
    }
    expect(out.ended).toBe(true);
    expect(seen.length).toBe(4);
  });

  test('n=Infinity with slow last item: every push lands', async () => {
    // With Infinity, shift drains to EOF immediately while every callback
    // is still in flight. The tail gather must wait for the slowest.
    const q = Superqueue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const out = q.upipe(async v => {
      await delay(v === 10 ? 80 : 5);
      return v;
    }, Infinity);
    const values = await out.collect();
    expect(values.length).toBe(10);
    expect(values.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test('n=Infinity with heterogeneous delays: output queue stays open until last push', async () => {
    const q = Superqueue.fromArray([1, 2, 3, 4, 5]);
    const out = q.upipe(async v => {
      await delay(v * 15);
      return v;
    }, Infinity);
    const seen: number[] = [];
    for await (const v of out) {
      seen.push(v);
      if (seen.length < 5) expect(out.ended).toBe(false);
    }
    expect(out.ended).toBe(true);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test('n=Infinity under high fan-out: no pushes dropped', async () => {
    const N = 200;
    const q = Superqueue.fromArray(Array.from({length: N}, (_, i) => i));
    const out = q.upipe(async v => {
      await delay(Math.random() * 20);
      return v;
    }, Infinity);
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
