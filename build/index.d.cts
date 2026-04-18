//#region src/index.d.ts
declare const EOF: unique symbol;
type EOF = typeof EOF;
/**
 * An async queue with push/shift, end, backpressure (pause/resume), and a
 * set of composable pipeline operators.
 *
 * Naming convention: methods prefixed with `u` (upipe, usplit, umerge) are
 * "unordered" — their output is not guaranteed to preserve input order.
 * upipe/usplit run their async callbacks in parallel (bounded by
 * concurrency()), so faster callbacks can overtake slower ones. umerge
 * interleaves values from two sources arbitrarily. Their plain
 * counterparts (pipe, split) run callbacks serially and preserve order.
 */
declare class Superqueue<T> {
  #private;
  static readonly EOF: symbol;
  ended: boolean;
  piped: boolean;
  paused: boolean;
  constructor();
  /**
   * Creates a new queue from an array of values.
   * @param array The array to create the queue from.
   * @returns A new queue containing the values from the array.
   */
  static fromArray<T>(array: Array<T>): Superqueue<T>;
  waitForShift: () => Promise<void>;
  /**
   * Returns a promise that resolves when the queue has ended.
   */
  waitForEnd: () => Promise<void>;
  /**
   * Returns the current size of the queue.
   */
  size: () => number;
  /**
   * Returns the total number of values pushed into the queue.
   */
  pushCount: () => number;
  /**
   * Pushes one or more values into the queue.
   * @param vals The values to push into the queue.
   */
  push: (...vals: T[]) => void;
  /**
   * Ends the queue, indicating that no more values will be pushed.
   * Idempotent — calling end() on an already-ended queue is a no-op,
   * so internal plumbing can safely close an output queue that a
   * caller may have already ended externally.
   */
  end: () => void;
  /**
   * Pauses consumption. Any in-flight #shift calls will block until resume()
   * is called. Items already returned by #shift before pause() was called are
   * unaffected, but downstream pipelines (consume/pipe/etc.) will stop
   * pulling new items until the queue is resumed. Idempotent.
   */
  pause: () => void;
  /**
   * Resumes consumption after pause(). Idempotent.
   */
  resume: () => void;
  /**
   * Shifts a value from the queue without any safety checks.
   */
  shiftUnsafe: () => Promise<T | typeof EOF>;
  /**
   * Implements the async iterator protocol, allowing the queue to be consumed
   * in a for-await-of loop. Marks the queue as piped.
   * @example
   * for await (const item of queue) {
   *   console.log(item);
   * }
   * @returns An async generator that yields values from the queue.
   */
  [Symbol.asyncIterator]: (this: Superqueue<T>) => AsyncGenerator<T, void, unknown>;
  /**
   * Sets the maximum number of in-flight callbacks for this queue's
   * consume/upipe/usplit pipeline. Can be called before piping starts
   * or live from inside a running callback — changes take effect on the
   * next iteration. Returns the queue for fluent chaining.
   *
   * Concurrency is per-queue: pipe/upipe/usplit outputs get the default.
   * clone() is the exception — all clones inherit the source's concurrency.
   */
  concurrency: (n: number) => this;
  /**
   * Consumes each value in the queue with the provided callback. If the
   * callback returns a Promise, it is tracked against concurrency() and
   * awaited at the tail before resolution. Synchronous (or void) returns
   * are fire-and-forget — not tracked, not awaited. A single queue can
   * mix both shapes per call if the callback does so conditionally.
   */
  consume: (callback: (v: T) => void | Promise<void>) => Promise<void>;
  /**
   * Pipes values through a synchronous callback into a new queue. Runs
   * serially, so output order matches input order. Returning undefined
   * filters the value out. For async callbacks that can run in parallel,
   * see upipe (unordered).
   */
  pipe: <U>(callback: (v: T) => U | undefined) => Superqueue<U>;
  /**
   * Unordered: pipes values through an async callback into a new queue.
   * Callbacks run in parallel bounded by concurrency(), so output order
   * is NOT guaranteed to match input order. Returning undefined filters
   * the value out. Use pipe() if order preservation matters.
   */
  upipe: <U>(callback: (v: T) => Promise<U | undefined>) => Superqueue<U>;
  /**
   * Splits the queue into two new queues based on a synchronous routing
   * callback. Runs serially, so within each output queue the relative
   * order of routed values matches their input order. For async routing
   * that can run in parallel, see usplit (unordered).
   */
  split: <U, V = U>(callback: (v: T) => [U, 0] | [V, 1]) => [Superqueue<U>, Superqueue<V>];
  /**
   * Batches values into arrays. Accepts either a numeric size cap or a
   * predicate `(size, startTime) => boolean` evaluated on each item —
   * returning true triggers a flush. In both forms an optional `idleMs`
   * argument flushes the partial buffer after that many ms of no new
   * items, which is the only way to recover partial batches when the
   * source stalls (a predicate alone runs only on item arrival).
   * Whatever remains in the buffer when the source ends is flushed.
   */
  batch: (sizeOrFlushWhen: number | ((size: number, startTime: number) => boolean), idleMs?: number) => Superqueue<T[]>;
  /**
   * Flattens the values in the queue, assuming each value is an array.
   * @returns A new queue containing the flattened values.
   */
  flat: () => Superqueue<T extends (infer U)[] ? U : never>;
  /**
   * Unordered: splits the queue into two new queues based on an async
   * routing callback. Callbacks run in parallel bounded by concurrency(),
   * so within each output queue the order of routed values is NOT
   * guaranteed. Returning undefined filters the value out. Use split() if
   * order preservation matters.
   */
  usplit: <U, V = U>(callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>) => [Superqueue<U>, Superqueue<V>];
  /**
   * Unordered: merges values from another queue with this queue into a
   * new queue. Both sources are drained in parallel and their values
   * interleave arbitrarily — no ordering guarantee between or within
   * sources.
   */
  umerge: (q: Superqueue<T>) => Superqueue<T>;
  /**
   * Creates multiple clones of the queue.
   * @param count The number of clone queues to create (default: 2).
   * @returns An array of cloned queues.
   */
  clone: (count?: number) => Superqueue<T>[];
  /**
   * Collects all the values in the queue into an array.
   * @returns A promise that resolves to an array containing all the values in the queue.
   */
  collect: () => Promise<T[]>;
}
//#endregion
export { Superqueue };