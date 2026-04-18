const EOF: unique symbol = Symbol('Superqueue.EOF');
type EOF = typeof EOF;

class Superqueue<T> {
  static readonly EOF = EOF;
  static readonly #defaultConcurrency = 8;

  #queue: T[] = [];

  #prom: Promise<void> | null = null;
  #endProm: Promise<void>;

  #resolveNext: (() => void) | null = null;
  #resolveEnd: (() => void) | null = null;
  #pushCount = 0;

  #shiftResolvers: (() => void)[] = [];

  #pauseProm: Promise<void> | null = null;
  #resolvePause: (() => void) | null = null;

  #concurrency: number = Superqueue.#defaultConcurrency;

  public ended = false;
  public piped = false;
  public paused = false;

  constructor() {
    this.#prom = new Promise(resolve => (this.#resolveNext = resolve));
    this.#endProm = new Promise(resolve => (this.#resolveEnd = resolve));
  }

  #run() {
    this.#resolveNext?.();
    this.#prom = new Promise(resolve => (this.#resolveNext = resolve));
  }

  #waitForPush() {
    return this.#prom || Promise.resolve();
  }

  #shift = async (): Promise<T | EOF> => {
    while (true) {
      if (this.paused) {
        await this.#pauseProm;
        continue;
      }
      if (this.size() === 0) {
        if (this.ended) return EOF;
        await this.#waitForPush();
        continue;
      }
      try {
        return this.#queue.shift()!;
      } finally {
        this.#shiftResolvers.map(r => r());
      }
    }
  };

  /**
   * Creates a new queue from an array of values.
   * @param array The array to create the queue from.
   * @returns A new queue containing the values from the array.
   */
  static fromArray<T>(array: Array<T>) {
    const queue = new Superqueue<T>();
    for (const item of array) queue.push(item);
    queue.end();
    return queue;
  }

  #preparePipe() {
    if (this.piped) throw new Error('Superqueue already piped');
    this.piped = true;
  }

  /*
   * Returns a promise that resolves when any item has been consumed from the queue.
   */
  waitForShift = () =>
    new Promise<void>(resolve => this.#shiftResolvers.push(resolve));

  /**
   * Returns a promise that resolves when the queue has ended.
   */
  waitForEnd = () => this.#endProm;

  /**
   * Returns the current size of the queue.
   */
  size = () => this.#queue.length;

  /**
   * Returns the total number of values pushed into the queue.
   */
  pushCount = () => this.#pushCount;

  /**
   * Pushes one or more values into the queue.
   * @param vals The values to push into the queue.
   */
  push = (...vals: T[]) => {
    if (this.ended) throw new Error('Superqueue has ended');

    this.#pushCount += vals.length;
    this.#queue.push(...vals);
    this.#run();
  };

  /**
   * Ends the queue, indicating that no more values will be pushed.
   */
  end = () => {
    if (this.ended) throw new Error('Superqueue has ended');

    this.ended = true;
    this.#run();
    this.#resolveEnd!();
  };

  /**
   * Pauses consumption. Any in-flight #shift calls will block until resume()
   * is called. Items already returned by #shift before pause() was called are
   * unaffected, but downstream pipelines (consume/pipe/etc.) will stop
   * pulling new items until the queue is resumed. Idempotent.
   */
  pause = () => {
    if (this.paused) return;
    this.paused = true;
    this.#pauseProm = new Promise(resolve => (this.#resolvePause = resolve));
  };

  /**
   * Resumes consumption after pause(). Idempotent.
   */
  resume = () => {
    if (!this.paused) return;
    this.paused = false;
    this.#resolvePause?.();
    this.#pauseProm = null;
    this.#resolvePause = null;
  };

  /**
   * Shifts a value from the queue without any safety checks.
   */
  shiftUnsafe = () => this.#shift();

  /**
   * Implements the async iterator protocol, allowing the queue to be consumed
   * in a for-await-of loop. Marks the queue as piped.
   * @example
   * for await (const item of queue) {
   *   console.log(item);
   * }
   * @returns An async generator that yields values from the queue.
   */
  [Symbol.asyncIterator] = async function* (
    this: Superqueue<T>,
  ): AsyncGenerator<T, void, unknown> {
    this.#preparePipe();

    for (let r = await this.#shift(); r !== EOF; r = await this.#shift())
      yield r as T;
  };

  /**
   * Sets the maximum number of in-flight callbacks for this queue's
   * consume/upipe/usplit pipeline. Can be called before piping starts
   * or live from inside a running callback — changes take effect on the
   * next iteration. Returns the queue for fluent chaining.
   *
   * Concurrency is per-queue: pipe/upipe/usplit outputs get the default.
   * clone() is the exception — all clones inherit the source's concurrency.
   */
  concurrency = (n: number): this => {
    this.#concurrency = n === Infinity ? Infinity : Math.max(1, n || 1);
    return this;
  };

  /**
   * Consumes each value in the queue with the provided callback. If the
   * callback returns a Promise, it is tracked against concurrency() and
   * awaited at the tail before resolution. Synchronous (or void) returns
   * are fire-and-forget — not tracked, not awaited. A single queue can
   * mix both shapes per call if the callback does so conditionally.
   */
  consume = async (callback: (v: T) => void | Promise<void>) => {
    this.#preparePipe();
    let proms: Promise<unknown>[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      while (proms.length >= this.#concurrency) {
        const {index} = await Promise.race(
          proms.map(async (p, index) => ({v: await p, index})),
        );
        proms = proms.filter((_, i) => i !== index);
      }
      const r = await this.#shift();
      if (r === EOF) break;

      const result = callback(r);
      if (result instanceof Promise) proms.push(result);
    }
    if (proms.length > 0) {
      await Promise.allSettled(proms);
    }
  };

  /**
   * Pipes the values from the queue through the provided callback function and returns a new queue with the results.
   * @param callback The function to apply to each value in the queue.
   * @returns A new queue containing the results of the callback function.
   */
  pipe = <U>(callback: (v: T) => U | undefined) => {
    const outSuperqueue = new Superqueue<U>();

    const c = (v: T) => {
      const r = callback(v);
      if (r !== undefined) outSuperqueue.push(r);
    };
    void this.consume(c).then(outSuperqueue.end);
    return outSuperqueue;
  };

  /**
   * Pipes the values from the queue through the provided async callback
   * function and returns a new queue with the results. Concurrency is
   * controlled by concurrency() on this queue.
   */
  upipe = <U>(callback: (v: T) => Promise<U | undefined>) => {
    const outSuperqueue = new Superqueue<U>();

    const c = async (v: T) => {
      const r = await callback(v);
      if (r !== undefined) outSuperqueue.push(r);
    };
    void this.consume(c).then(outSuperqueue.end);
    return outSuperqueue;
  };

  /**
   * Splits the queue into two new queues based on the provided callback function.
   * @param callback The function to determine which queue each value should be sent to.
   * @returns A tuple containing the two new queues.
   */
  split = <U, V = U>(
    callback: (v: T) => [U, 0] | [V, 1],
  ): [Superqueue<U>, Superqueue<V>] => {
    const q1 = new Superqueue<U>();
    const q2 = new Superqueue<V>();

    const c = (v: T) => {
      const [value, index] = callback(v);

      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error('Invalid index');
    };
    void this.consume(c).then(() => {
      q1.end();
      q2.end();
    });
    return [q1, q2];
  };

  /**
   * Batches the values in the queue into arrays of the specified size.
   * @param n The size of each batch.
   * @returns A new queue containing arrays of values from the original queue.
   */
  batch = (n: number) => {
    const outSuperqueue = new Superqueue<T[]>();
    let buffer: T[] = [];

    void this.consume(v => {
      buffer.push(v);

      if (buffer.length === n) {
        outSuperqueue.push(buffer);
        buffer = [];
      }
    }).then(() => {
      if (buffer.length > 0) outSuperqueue.push(buffer);
      outSuperqueue.end();
    });
    return outSuperqueue;
  };

  /**
   * Flattens the values in the queue, assuming each value is an array.
   * @returns A new queue containing the flattened values.
   */
  flat = () => {
    const outSuperqueue = new Superqueue<T extends Array<infer U> ? U : never>();
    void this.consume(v => {
      if (v instanceof Array) outSuperqueue.push(...v);
      else throw new Error('Value is not an array');
    }).then(outSuperqueue.end);
    return outSuperqueue;
  };

  /**
   * Splits the queue into two new queues based on the provided async
   * callback function. Concurrency is controlled by concurrency() on this
   * queue.
   */
  usplit = <U, V = U>(
    callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>,
  ): [Superqueue<U>, Superqueue<V>] => {
    const q1 = new Superqueue<U>();
    const q2 = new Superqueue<V>();

    const c = async (v: T) => {
      const r = await callback(v);
      if (r === undefined) return;
      const [value, index] = r;

      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error('Invalid index');
    };
    void this.consume(c).then(() => {
      q1.end();
      q2.end();
    });
    return [q1, q2];
  };

  /**
   * Merges the values from another queue into this queue.
   * @param q The queue to merge values from.
   * @returns A new queue containing the merged values.
   */
  umerge = (q: Superqueue<T>) => {
    const outSuperqueue = new Superqueue<T>();

    void Promise.all([this, q].map(q => q.consume(outSuperqueue.push))).then(
      outSuperqueue.end,
    );
    return outSuperqueue;
  };

  /**
   * Creates multiple clones of the queue.
   * @param count The number of clone queues to create (default: 2).
   * @returns An array of cloned queues.
   */
  clone = (count = 2) => {
    if (count < 1) throw new Error('Count must be at least 1');

    const queues = Array.from({length: count}, () => {
      const q = new Superqueue<T>();
      q.#concurrency = this.#concurrency;
      return q;
    });
    void this.consume(v => queues.map(q => q.push(v))).then(() =>
      queues.map(q => q.end()),
    );
    return queues;
  };

  /**
   * Collects all the values in the queue into an array.
   * @returns A promise that resolves to an array containing all the values in the queue.
   */
  collect = async () => {
    const arr: T[] = [];
    await this.consume(e => arr.push(e));
    return arr;
  };
}

export {Superqueue};
