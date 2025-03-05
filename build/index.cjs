"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var Queue = class _Queue {
  static EOF = void 0;
  _queue = [];
  _prom = null;
  _resolveNext = null;
  _endProm;
  _resolveEnd = null;
  _pushCount = 0;
  _shiftResolvers = [];
  ended = false;
  piped = false;
  static _batchCount = 8;
  static _eof = void 0;
  constructor() {
    this._prom = new Promise((resolve) => this._resolveNext = resolve);
    this._endProm = new Promise((resolve) => this._resolveEnd = resolve);
  }
  _run() {
    this._resolveNext?.();
    this._prom = new Promise((resolve) => this._resolveNext = resolve);
  }
  _waitForPush() {
    return this._prom;
  }
  _shift = async () => {
    if (this.size() === 0) {
      if (this.ended) throw new Error("Queue has ended");
      await this._waitForPush();
      return await this._shift();
    }
    try {
      return this._queue.shift();
    } finally {
      this._shiftResolvers.map((r) => r());
    }
  };
  /**
   * Creates a new queue from an array of values.
   * @param array The array to create the queue from.
   * @returns A new queue containing the values from the array.
   */
  static fromArray(array) {
    const queue = new _Queue();
    for (const item of array) queue.push(item);
    queue.end();
    return queue;
  }
  _preparePipe() {
    if (this.piped) throw new Error("Queue already piped");
    this.piped = true;
  }
  /*
   * Returns a promise that resolves when any item has been consumed from the queue.
   */
  waitForShift = () => new Promise((resolve) => this._shiftResolvers.push(resolve));
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
  push = (...vals) => {
    if (this.ended) throw new Error("Queue has ended");
    if (vals.some((val) => val === _Queue._eof))
      throw new Error("Value can't be undefined. Please use null.");
    this._pushCount += vals.length;
    this._queue.push(...vals);
    this._run();
  };
  /**
   * Ends the queue, indicating that no more values will be pushed.
   */
  end = () => {
    if (this.ended) throw new Error("Queue has ended");
    this._queue.push(_Queue._eof);
    this._run();
    this.ended = true;
    this._resolveEnd();
  };
  /**
   * Shifts a value from the queue without any safety checks.
   */
  shiftUnsafe = () => this._shift();
  /**
   * Maps each value in the queue using the provided callback function.
   * @param callback The function to apply to each value in the queue.
   */
  map = async (callback) => {
    this._preparePipe();
    for (let r = await this._shift(); r !== _Queue._eof; r = await this._shift())
      callback(r);
  };
  /**
   * Maps each value in the queue using the provided async callback function in parallel.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   */
  mapParallel = async (callback, n = _Queue._batchCount) => {
    this._preparePipe();
    let proms = [];
    while (true) {
      if (proms.length === n) {
        const { index } = await Promise.race(
          proms.map(async (p, index2) => ({ v: await p, index: index2 }))
        );
        proms = proms.filter((_, i) => i !== index);
      }
      const r = await this._shift();
      if (r === _Queue._eof) break;
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
  pipe = (callback) => {
    const outQueue = new _Queue();
    const c = (v) => {
      const r = callback(v);
      if (r !== void 0) outQueue.push(r);
    };
    void this.map(c).then(outQueue.end);
    return outQueue;
  };
  /**
   * Pipes the values from the queue through the provided async callback function and returns a new queue with the results.
   * @param callback The async function to apply to each value in the queue.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   * @returns A new queue containing the results of the async callback function.
   */
  upipe = (callback, n = _Queue._batchCount) => {
    const outQueue = new _Queue();
    const c = async (v) => {
      const r = await callback(v);
      if (r !== void 0) outQueue.push(r);
    };
    void this[n === Infinity ? "map" : "mapParallel"](c, n).then(outQueue.end);
    return outQueue;
  };
  /**
   * Splits the queue into two new queues based on the provided callback function.
   * @param callback The function to determine which queue each value should be sent to.
   * @returns A tuple containing the two new queues.
   */
  split = (callback) => {
    const q1 = new _Queue();
    const q2 = new _Queue();
    const c = (v) => {
      const [value, index] = callback(v);
      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error("Invalid index");
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
  batch = (n) => {
    const outQueue = new _Queue();
    let buffer = [];
    void this.map((v) => {
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
    const outQueue = new _Queue();
    void this.map((v) => {
      if (v instanceof Array) outQueue.push(...v);
      else throw new Error("Value is not an array");
    }).then(outQueue.end);
    return outQueue;
  };
  /**
   * Splits the queue into two new queues based on the provided async callback function.
   * @param callback The async function to determine which queue each value should be sent to.
   * @param n The maximum number of parallel executions (default: Queue._batchCount).
   * @returns A tuple containing the two new queues.
   */
  usplit = (callback, n = _Queue._batchCount) => {
    const q1 = new _Queue();
    const q2 = new _Queue();
    const c = async (v) => {
      const r = await callback(v);
      if (r === void 0) return;
      const [value, index] = r;
      if (index === 0) q1.push(value);
      else if (index === 1) q2.push(value);
      else throw new Error("Invalid index");
    };
    void this[n === Infinity ? "map" : "mapParallel"](c, n).then(() => {
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
  umerge = (q) => {
    const outQueue = new _Queue();
    void Promise.all([this, q].map((q2) => q2.map(outQueue.push))).then(
      outQueue.end
    );
    return outQueue;
  };
  /**
   * Creates multiple clones of the queue.
   * @param count The number of clone queues to create (default: 1).
   * @returns An array of cloned queues.
   */
  clone = (count = 1) => {
    if (count < 1) throw new Error("Count must be at least 1");
    const queues = Array.from({ length: count }, () => new _Queue());
    void this.map((v) => queues.map((q) => q.push(v))).then(
      () => queues.map((q) => q.end())
    );
    return queues;
  };
  /**
   * Collects all the values in the queue into an array.
   * @returns A promise that resolves to an array containing all the values in the queue.
   */
  collect = async () => {
    const arr = [];
    await this.map((e) => arr.push(e));
    return arr;
  };
};
var index_default = Queue;
