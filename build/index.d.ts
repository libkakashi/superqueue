declare class Queue<T> {
    static EOF: undefined;
    private _queue;
    private _prom;
    private _resolveNext;
    private _endProm;
    private _resolveEnd;
    private _pushCount;
    private _shiftResolvers;
    ended: boolean;
    piped: boolean;
    private static readonly _batchCount;
    private static readonly _eof;
    constructor();
    private _run;
    private _waitForPush;
    private _shift;
    /**
     * Creates a new queue from an array of values.
     * @param array The array to create the queue from.
     * @returns A new queue containing the values from the array.
     */
    static fromArray<T>(array: Array<T>): Queue<T>;
    private _preparePipe;
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
     */
    end: () => void;
    /**
     * Shifts a value from the queue without any safety checks.
     */
    shiftUnsafe: () => Promise<T | undefined>;
    /**
     * Implements the async iterator protocol, allowing the queue to be consumed
     * in a for-await-of loop. Marks the queue as piped.
     * @example
     * for await (const item of queue) {
     *   console.log(item);
     * }
     * @returns An async generator that yields values from the queue.
     */
    [Symbol.asyncIterator]: (this: Queue<T>) => AsyncGenerator<T, void, unknown>;
    /**
     * Maps each value in the queue using the provided callback function.
     * @param callback The function to apply to each value in the queue.
     */
    map: (callback: (v: T) => void) => Promise<void>;
    /**
     * Maps each value in the queue using the provided async callback function in parallel.
     * @param callback The async function to apply to each value in the queue.
     * @param n The maximum number of parallel executions (default: Queue._batchCount).
     */
    mapParallel: (callback: (v: T) => Promise<unknown>, n?: number) => Promise<void>;
    /**
     * Pipes the values from the queue through the provided callback function and returns a new queue with the results.
     * @param callback The function to apply to each value in the queue.
     * @returns A new queue containing the results of the callback function.
     */
    pipe: <U>(callback: (v: T) => U | undefined) => Queue<U>;
    /**
     * Pipes the values from the queue through the provided async callback function and returns a new queue with the results.
     * @param callback The async function to apply to each value in the queue.
     * @param n The maximum number of parallel executions (default: Queue._batchCount).
     * @returns A new queue containing the results of the async callback function.
     */
    upipe: <U>(callback: (v: T) => Promise<U | undefined>, n?: number) => Queue<U>;
    /**
     * Splits the queue into two new queues based on the provided callback function.
     * @param callback The function to determine which queue each value should be sent to.
     * @returns A tuple containing the two new queues.
     */
    split: <U, V = U>(callback: (v: T) => [U, 0] | [V, 1]) => [Queue<U>, Queue<V>];
    /**
     * Batches the values in the queue into arrays of the specified size.
     * @param n The size of each batch.
     * @returns A new queue containing arrays of values from the original queue.
     */
    batch: (n: number) => Queue<T[]>;
    /**
     * Flattens the values in the queue, assuming each value is an array.
     * @returns A new queue containing the flattened values.
     */
    flat: () => Queue<T extends (infer U)[] ? U : never>;
    /**
     * Splits the queue into two new queues based on the provided async callback function.
     * @param callback The async function to determine which queue each value should be sent to.
     * @param n The maximum number of parallel executions (default: Queue._batchCount).
     * @returns A tuple containing the two new queues.
     */
    usplit: <U, V = U>(callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>, n?: number) => [Queue<U>, Queue<V>];
    /**
     * Merges the values from another queue into this queue.
     * @param q The queue to merge values from.
     * @returns A new queue containing the merged values.
     */
    umerge: (q: Queue<T>) => Queue<T>;
    /**
     * Creates multiple clones of the queue.
     * @param count The number of clone queues to create (default: 1).
     * @returns An array of cloned queues.
     */
    clone: (count?: number) => Queue<T>[];
    /**
     * Collects all the values in the queue into an array.
     * @returns A promise that resolves to an array containing all the values in the queue.
     */
    collect: () => Promise<T[]>;
}

export { Queue as default };
