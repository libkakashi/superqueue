type EOF = undefined;

class Queue<T> {
  static EOF = undefined;
  #queue: (T | EOF)[] = [];
  #prom: Promise<void> | null = null;
  #resolveNext: (() => void) | null = null;
  #endProm: Promise<void>;
  #resolveEnd: (() => void) | null = null;
  #pushCount = 0;

  #shiftResolvers: (() => void)[] = [];

  public ended = false;
  public piped = false;

  static readonly #batchCount = 8;
  static readonly #eof = undefined;

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
    if (this.size() === 0) {
      if (this.ended) return Queue.#eof;
      await this.#waitForPush();
      return await this.#shift();
    }
    try {
      return this.#queue.shift()!;
    } finally {
      this.#shiftResolvers.map(r => r());
    }
  };

  /**
   * Creates a new queue from an array of values.
   * @param array The array to create the queue from.
   * @returns A new queue containing the values from the array.
   */
  static fromArray<T>(array: Array<T>) {
    const queue = new Queue<T>();
    for (const item of array) queue.push(item);
    queue.end();
    return queue;
  }

  #preparePipe() {
    if (this.piped) throw new Error('Queue already piped');
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
    if (this.ended) throw new Error('Queue has ended');

    if (vals.some(val => val === Queue.#eof))
      throw new Error("Value can't be undefined. Please use null.");

    this.#pushCount += vals.length;
    this.#queue.push(...vals);
    this.#run();
  };

  /**
   * Ends the queue, indicating that no more values will be pushed.
   */
  end = () => {
    if (this.ended) throw new Error('Queue has ended');

    this.#queue.push(Queue.#eof);
    this.#run();
    this.ended = true;
    this.#resolveEnd!();
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
    this: Queue<T>,
  ): AsyncGenerator<T, void, unknown> {
    this.#preparePipe();

    for (let r = await this.#shift(); r !== Queue.#eof; r = await this.#shift())
      yield r as T;
  };

  /**
   * Maps each value in the queue using the provided callback function.
   * @param callback The function to apply to each value in the queue.
   */
  map = async (callback: (v: T) => void) => {
    this.#preparePipe();
    for (let r = await this.#shift(); r !== Queue.#eof; r = await this.#shift())
      callback(r);
  };

  /**
   * Maps each value in the queue using the provided async callback function in parallel.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue.#batchCount).
   */
  mapParallel = async (
    callback: (v: T) => Promise<unknown>,
    n: number = Queue.#batchCount,
  ) => {
    this.#preparePipe();
    let proms: Promise<unknown>[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (proms.length === n) {
        const {index} = await Promise.race(
          proms.map(async (p, index) => ({v: await p, index})),
        );
        proms = proms.filter((_, i) => i !== index);
      }
      const r = await this.#shift();
      if (r === Queue.#eof) break;
      proms.push(callback(r));
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
    const outQueue = new Queue<U>();

    const c = (v: T) => {
      const r = callback(v);
      if (r !== undefined) outQueue.push(r);
    };
    void this.map(c).then(outQueue.end);
    return outQueue;
  };

  /**
   * Pipes the values from the queue through the provided async callback function and returns a new queue with the results.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue.#batchCount).
   * @returns A new queue containing the results of the async callback function.
   */
  upipe = <U>(
    callback: (v: T) => Promise<U | undefined>,
    n: number = Queue.#batchCount,
  ) => {
    const outQueue = new Queue<U>();

    const c = async (v: T) => {
      const r = await callback(v);
      if (r !== undefined) outQueue.push(r);
    };
    void this[n === Infinity ? 'map' : 'mapParallel'](c, n).then(outQueue.end);
    return outQueue;
  };

  /**
   * Splits the queue into two new queues based on the provided callback function.
   * @param callback The function to determine which queue each value should be sent to.
   * @returns A tuple containing the two new queues.
   */
  split = <U, V = U>(
    callback: (v: T) => [U, 0] | [V, 1],
  ): [Queue<U>, Queue<V>] => {
    const q1 = new Queue<U>();
    const q2 = new Queue<V>();

    const c = (v: T) => {
      const [value, index] = callback(v);

      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error('Invalid index');
    };
    void this.map(c).then(() => {
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
    const outQueue = new Queue<T[]>();
    let buffer: T[] = [];

    void this.map(v => {
      buffer.push(v);

      if (buffer.length === n) {
        outQueue.push(buffer);
        buffer = [];
      }
    }).then(() => {
      if (buffer.length > 0) outQueue.push(buffer);
      outQueue.end();
    });
    return outQueue;
  };

  /**
   * Flattens the values in the queue, assuming each value is an array.
   * @returns A new queue containing the flattened values.
   */
  flat = () => {
    const outQueue = new Queue<T extends Array<infer U> ? U : never>();
    void this.map(v => {
      if (v instanceof Array) outQueue.push(...v);
      else throw new Error('Value is not an array');
    }).then(outQueue.end);
    return outQueue;
  };

  /**
   * Splits the queue into two new queues based on the provided async callback function.
   * @param callback The async function to determine which queue each value should be sent to.
   * @param n The maximum number of parallel executions (default: Queue.#batchCount).
   * @returns A tuple containing the two new queues.
   */
  usplit = <U, V = U>(
    callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>,
    n: number = Queue.#batchCount,
  ): [Queue<U>, Queue<V>] => {
    const q1 = new Queue<U>();
    const q2 = new Queue<V>();

    const c = async (v: T) => {
      const r = await callback(v);
      if (r === undefined) return;
      const [value, index] = r;

      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error('Invalid index');
    };
    void this[n === Infinity ? 'map' : 'mapParallel'](c, n).then(() => {
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
  umerge = (q: Queue<T>) => {
    const outQueue = new Queue<T>();
    void Promise.all([this, q].map(q => q.map(outQueue.push))).then(
      outQueue.end,
    );
    return outQueue;
  };

  /**
   * Creates multiple clones of the queue.
   * @param count The number of clone queues to create (default: 2).
   * @returns An array of cloned queues.
   */
  clone = (count = 2) => {
    if (count < 1) throw new Error('Count must be at least 1');
    const queues = Array.from({length: count}, () => new Queue<T>());

    void this.map(v => queues.map(q => q.push(v))).then(() =>
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
    await this.map(e => arr.push(e));
    return arr;
  };
}

export default Queue;
