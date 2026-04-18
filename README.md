# Superqueue

A small zero-dependency async queue library for building composable streaming pipelines in TypeScript. Think multiple airport counters with queues of people routed to minimize average waiting time.

## Install

```bash
bun add superqueue
# or
npm i superqueue
```

## Quick example

```ts
import {Superqueue} from 'superqueue';

const results = await Superqueue.fromArray([1, 2, 3, 4, 5])
  .concurrency(4)
  .upipe(async n => {
    await fetchSomething(n);
    return n * 2;
  })
  .collect();
// results is an unordered array of n*2 for each input
```

Real-world shape — fan-out pipeline with parallel stages, splits, and batching:

```ts
const videosQueue = await youtube.getChannelVideos(channelId); // Superqueue<VideoSnippetResponse>
const dbVideosIndex = /* ... */;

const idsQueue = videosQueue.pipe(v => v.resourceId!.videoId!);

const [freshIdsQueue, cachedIdsQueue] = idsQueue
  .pipe(id => (dbVideosIndex[id] ? undefined : id))
  .concurrency(16)
  .usplit(async id =>
    (await storage.exists(`transcript/${id}.vtt`)) ? [id, 1] : [id, 0],
  );

const metadatasQueue = freshIdsQueue
  .batch(50)
  .upipe(batch => youtube.getVideosMetadata(batch))
  .flat();

const [englishQueue, otherQueue] = metadatasQueue.split(m =>
  englishLangCodes.includes(m.defaultAudioLanguage) ? [m, 0] : [m, 1],
);

const [goodSubs, badSubs] = englishQueue
  .concurrency(8)
  .usplit(async m => {
    try {
      return [{...m, path: await youtube.downloadSubtitles(m.videoId)}, 0];
    } catch {
      return [m, 1];
    }
  });
```

## API

### Construction

- **`new Superqueue<T>()`** — empty queue.
- **`Superqueue.fromArray<T>(array)`** — preloaded, auto-ended queue.

### Lifecycle

- **`push(...vals: T[])`** — enqueue values. Throws if the queue is ended.
- **`end()`** — no more values. Idempotent.
- **`pause()` / `resume()`** — gate consumption. `#shift` blocks while paused; producers can still `push`/`end`. Idempotent.
- **`fail`** — *no explicit fail mechanism*. User callback throws are expected to be caught by the callback itself; the library just guarantees the pipeline closes rather than hangs (see Error handling below).

### Consumption

- **`collect(): Promise<T[]>`** — drain into an array.
- **`consume(callback: (v: T) => void | Promise<void>)`** — run a callback per value. If the callback returns a Promise it is tracked against `concurrency()` and gathered before `consume` resolves; synchronous returns are fire-and-forget.
- **`[Symbol.asyncIterator]`** — `for await (const v of queue) ...`.
- **`shiftUnsafe(): Promise<T | typeof Superqueue.EOF>`** — single-shift escape hatch. Bypasses the "piped" guard; caller owns the lifecycle.

### Transforms

| Method | Sync / Async | Order |
| --- | --- | --- |
| `pipe(fn)` | sync callback | preserved |
| `upipe(fn)` | async callback | **unordered** (parallel, bounded by `concurrency()`) |
| `split(fn) → [Q, Q]` | sync routing | preserved |
| `usplit(fn) → [Q, Q]` | async routing | **unordered** |
| `umerge(other) → Q` | — | **unordered** (interleaves two sources) |
| `batch(size \| predicate, idleMs?)` | — | preserved |
| `flat()` | — | preserved |
| `clone(count = 2) → Q[]` | — | preserved (each clone sees every value) |

`u`-prefixed methods don't preserve input order because callbacks run in parallel or sources interleave. Use the plain counterpart (`pipe`/`split`) for order.

- **`pipe<U>(callback: (v: T) => U | undefined): Superqueue<U>`** — returning `undefined` filters.
- **`upipe<U>(callback: (v: T) => Promise<U | undefined>): Superqueue<U>`** — ditto, async.
- **`split<U, V = U>(callback: (v: T) => [U, 0] | [V, 1]): [Superqueue<U>, Superqueue<V>]`**
- **`usplit<U, V = U>(callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>): [Superqueue<U>, Superqueue<V>]`** — returning `undefined` filters.
- **`umerge(q: Superqueue<T>): Superqueue<T>`**
- **`batch(sizeOrPredicate, idleMs?)`** — numeric size cap, OR a predicate `(size, startTime) => boolean` evaluated on each item. `idleMs` flushes the partial buffer after a stall.
- **`flat()`** — flattens array values.
- **`clone(count = 2)`** — multi-reader copies; each clone inherits the source's concurrency.

### Concurrency

- **`concurrency(n: number): this`** — set the max in-flight callbacks for `consume`/`upipe`/`usplit` on this queue. Throws for non-positive-integer values; accepts `Infinity` for unbounded. Can be called before piping *or* live from inside a callback to retune (the loop re-reads every iteration). Defaults to 8.

```ts
q.concurrency(10).upipe(async x => { ... });

// or live-retune:
q.upipe(async x => {
  if (backpressureHigh()) q.concurrency(2);
  return await work(x);
});
```

### Signals

- **`ended: boolean`**, **`paused: boolean`**, **`piped: boolean`** — observable flags.
- **`size(): number`** — current queue length.
- **`pushCount(): number`** — total values ever pushed.
- **`waitForEnd(): Promise<void>`** — resolves when `end()` fires.
- **`waitForShift(): Promise<void>`** — resolves the next time a value is consumed from this queue.

### EOF

- **`Superqueue.EOF`** — a unique symbol returned by `shiftUnsafe` when the queue is drained and ended. `undefined` is a legal user value (it's not the sentinel).

## Error handling

Superqueue does not surface user-callback errors as a first-class signal. The semantics are:

- If a user callback throws (sync) or rejects (async), the upstream `consume`'s promise rejects.
- Derived-queue constructors wire `.finally(end)` so the output queue **always closes**, even on error — no silent hangs.
- The rejection itself propagates as an unhandled rejection (visible in logs). Catch inside your callback if you want to observe or recover from it.

If you need "keep going on error" semantics, wrap your callback in try/catch; the queue won't notice.

## Running tests

```bash
bun run test
```

Runs the unit suite (`bun test`) plus a manual integration harness that asserts pipeline-closes-on-throw across every operator — Bun's test runner fails on unhandled rejections through a path that `process.on` can't intercept, so those scenarios live outside `bun test`.
