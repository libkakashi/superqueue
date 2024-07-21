type EOF = undefined;

class Queue<T> {
  static EOF = undefined;
  private _queue: (T | EOF)[] = [];
  private _prom: Promise<void> | null = null;
  private _resolveNext: (() => void) | null = null;
  private _endProm: Promise<void>;
  private _resolveEnd: (() => void) | null = null;
  private _pushCount = 0;

  private _shiftResolvers: (() => void)[] = [];

  public ended = false;
  public piped = false;

  private static readonly _batchCount = 8;
  private static readonly _eof = undefined;

  constructor() {
    this._prom = new Promise(resolve => (this._resolveNext = resolve));
    this._endProm = new Promise(resolve => (this._resolveEnd = resolve));
  }

  private _run() {
    this._resolveNext?.();
    this._prom = new Promise(resolve => (this._resolveNext = resolve));
  }

  private _waitForPush() {
    return this._prom;
  }

  private _shift = async (): Promise<T | EOF> => {
    if (this.size() === 0) {
      if (this.ended) throw new Error('Queue has ended');
      await this._waitForPush();
      return await this._shift();
    }
    try {
      return this._queue.shift()!;
    } finally {
      this._shiftResolvers.map(r => r());
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

  private _preparePipe() {
    if (this.piped) throw new Error('Queue already piped');
    this.piped = true;
  }

  /*
   * Returns a promise that resolves when any item has been consumed from the queue.
   */
  waitForShift = () =>
    new Promise<void>(resolve => this._shiftResolvers.push(resolve));

  /**
   * Returns a promise that resolves when the queue has ended.
   */
  waitForEnd = () => this._endProm;

  /**
   * Returns the current size of the queue.
   */
  size = () => this._queue.length;

  /**
   * Returns the total number of values pushed into the queue.
   */
  pushCount = () => this._pushCount;

  /**
   * Pushes one or more values into the queue.
   * @param vals The values to push into the queue.
   */
  push = (...vals: T[]) => {
    if (this.ended) throw new Error('Queue has ended');

    if (vals.some(val => val === Queue._eof))
      throw new Error("Value can't be undefined. Please use null.");

    this._pushCount += vals.length;
    this._queue.push(...vals);
    this._run();
  };

  /**
   * Ends the queue, indicating that no more values will be pushed.
   */
  end = () => {
    if (this.ended) throw new Error('Queue has ended');

    this._queue.push(Queue._eof);
    this._run();
    this.ended = true;
    this._resolveEnd!();
  };

  /**
   * Shifts a value from the queue without any safety checks.
   */
  shiftUnsafe = () => this._shift();

  /**
   * Maps each value in the queue using the provided callback function.
   * @param callback The function to apply to each value in the queue.
   */
  map = async (callback: (v: T) => void) => {
    this._preparePipe();
    for (let r = await this._shift(); r !== Queue._eof; r = await this._shift())
      callback(r);
  };

  /**
   * Maps each value in the queue using the provided async callback function in parallel.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   */
  mapParallel = async (
    callback: (v: T) => Promise<unknown>,
    n: number = Queue._batchCount
  ) => {
    this._preparePipe();
    let proms: Promise<unknown>[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (proms.length === n) {
        const {index} = await Promise.race(
          proms.map(async (p, index) => ({v: await p, index}))
        );
        proms = proms.filter((_, i) => i !== index);
      }
      const r = await this._shift();
      if (r === Queue._eof) break;
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
    this.map(c).then(outQueue.end);
    return outQueue;
  };

  /**
   * Pipes the values from the queue through the provided async callback function and returns a new queue with the results.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   * @returns A new queue containing the results of the async callback function.
   */
  upipe = <U>(
    callback: (v: T) => Promise<U | undefined>,
    n: number = Queue._batchCount
  ) => {
    const outQueue = new Queue<U>();

    const c = async (v: T) => {
      const r = await callback(v);
      if (r !== undefined) outQueue.push(r);
    };
    this[n === Infinity ? 'map' : 'mapParallel'](c, n).then(outQueue.end);
    return outQueue;
  };

  /**
   * Splits the queue into two new queues based on the provided callback function.
   * @param callback The function to determine which queue each value should be sent to.
   * @returns A tuple containing the two new queues.
   */
  split = <U, V = U>(
    callback: (v: T) => [U, 0] | [V, 1]
  ): [Queue<U>, Queue<V>] => {
    const q1 = new Queue<U>();
    const q2 = new Queue<V>();

    const c = (v: T) => {
      const [value, index] = callback(v);

      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error('Invalid index');
    };
    this.map(c).then(() => {
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

    this.map(v => {
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
    this.map(v => {
      if (v instanceof Array) outQueue.push(...v);
      else throw new Error('Value is not an array');
    }).then(outQueue.end);
    return outQueue;
  };

  /**
   * Splits the queue into two new queues based on the provided async callback function.
   * @param callback The async function to determine which queue each value should be sent to.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   * @returns A tuple containing the two new queues.
   */
  usplit = <U, V = U>(
    callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>,
    n: number = Queue._batchCount
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
    this[n === Infinity ? 'map' : 'mapParallel'](c, n).then(() => {
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
    Promise.all([this, q].map(q => q.map(outQueue.push))).then(outQueue.end);
    return outQueue;
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
