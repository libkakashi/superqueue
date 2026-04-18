Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/index.ts
let _Symbol$asyncIterator;
const EOF = Symbol("Superqueue.EOF");
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
var Superqueue = class Superqueue {
	static #_ = _Symbol$asyncIterator = Symbol.asyncIterator;
	static #_2 = this.EOF = EOF;
	static #defaultConcurrency = 8;
	#queue = [];
	#prom = null;
	#endProm;
	#shiftProm;
	#resolveNext = null;
	#resolveEnd = null;
	#resolveShift = null;
	#pushCount = 0;
	#pauseProm = null;
	#resolvePause = null;
	#concurrency = Superqueue.#defaultConcurrency;
	constructor() {
		this.ended = false;
		this.piped = false;
		this.paused = false;
		this.waitForShift = () => this.#shiftProm;
		this.waitForEnd = () => this.#endProm;
		this.size = () => this.#queue.length;
		this.pushCount = () => this.#pushCount;
		this.push = (...vals) => {
			if (this.ended) throw new Error("Superqueue has ended");
			this.#pushCount += vals.length;
			this.#queue.push(...vals);
			this.#run();
		};
		this.end = () => {
			if (this.ended) return;
			this.ended = true;
			this.#run();
			this.#resolveEnd();
		};
		this.pause = () => {
			if (this.paused) return;
			this.paused = true;
			[this.#pauseProm, this.#resolvePause] = Superqueue.#freshGate();
		};
		this.resume = () => {
			var _this$resolvePause;
			if (!this.paused) return;
			this.paused = false;
			(_this$resolvePause = this.#resolvePause) === null || _this$resolvePause === void 0 || _this$resolvePause.call(this);
			this.#pauseProm = null;
			this.#resolvePause = null;
		};
		this.shiftUnsafe = () => this.#shift();
		this[_Symbol$asyncIterator] = async function* () {
			this.#preparePipe();
			for (let r = await this.#shift(); r !== EOF; r = await this.#shift()) yield r;
		};
		this.concurrency = (n) => {
			if (n !== Infinity && (!Number.isInteger(n) || n < 1)) throw new Error(`Invalid concurrency: ${n}. Must be a positive integer or Infinity.`);
			this.#concurrency = n;
			return this;
		};
		this.consume = async (callback) => {
			this.#preparePipe();
			let proms = [];
			while (true) {
				while (proms.length >= this.#concurrency) {
					const { index } = await Promise.race(proms.map(async (p, index) => ({
						v: await p,
						index
					})));
					proms = proms.filter((_, i) => i !== index);
				}
				const r = await this.#shift();
				if (r === EOF) break;
				const result = callback(r);
				if (result instanceof Promise) proms.push(result);
			}
			if (proms.length > 0) await Promise.allSettled(proms);
		};
		this.pipe = (callback) => {
			const outQueue = new Superqueue();
			const c = (v) => {
				const r = callback(v);
				if (r !== void 0) outQueue.push(r);
			};
			this.consume(c).finally(outQueue.end);
			return outQueue;
		};
		this.upipe = (callback) => {
			const outQueue = new Superqueue();
			const c = async (v) => {
				const r = await callback(v);
				if (r !== void 0) outQueue.push(r);
			};
			this.consume(c).finally(outQueue.end);
			return outQueue;
		};
		this.split = (callback) => {
			const q1 = new Superqueue();
			const q2 = new Superqueue();
			const c = (v) => {
				const [value, index] = callback(v);
				if (index === 0) q1.push(value);
				else if (index === 1) q2.push(value);
				else throw new Error("Invalid index");
			};
			this.consume(c).finally(() => {
				q1.end();
				q2.end();
			});
			return [q1, q2];
		};
		this.batch = (sizeOrFlushWhen, idleMs) => {
			const outQueue = new Superqueue();
			let buffer = [];
			let startTime = 0;
			let idleTimer = null;
			const shouldFlush = typeof sizeOrFlushWhen === "function" ? sizeOrFlushWhen : (size) => size >= sizeOrFlushWhen;
			const clearIdle = () => {
				if (idleTimer !== null) {
					clearTimeout(idleTimer);
					idleTimer = null;
				}
			};
			const flush = () => {
				clearIdle();
				if (buffer.length === 0) return;
				outQueue.push(buffer);
				buffer = [];
			};
			this.consume((v) => {
				if (buffer.length === 0) startTime = Date.now();
				buffer.push(v);
				if (shouldFlush(buffer.length, startTime)) flush();
				else if (idleMs !== void 0) {
					clearIdle();
					idleTimer = setTimeout(flush, idleMs);
				}
			}).finally(() => {
				flush();
				outQueue.end();
			});
			return outQueue;
		};
		this.flat = () => {
			const outQueue = new Superqueue();
			this.consume((v) => {
				if (v instanceof Array) outQueue.push(...v);
				else throw new Error("Value is not an array");
			}).finally(outQueue.end);
			return outQueue;
		};
		this.usplit = (callback) => {
			const q1 = new Superqueue();
			const q2 = new Superqueue();
			const c = async (v) => {
				const r = await callback(v);
				if (r === void 0) return;
				const [value, index] = r;
				if (index === 0) q1.push(value);
				else if (index === 1) q2.push(value);
				else throw new Error("Invalid index");
			};
			this.consume(c).finally(() => {
				q1.end();
				q2.end();
			});
			return [q1, q2];
		};
		this.umerge = (q) => {
			const outQueue = new Superqueue();
			Promise.all([this, q].map((q) => q.consume(outQueue.push))).finally(outQueue.end);
			return outQueue;
		};
		this.clone = (count = 2) => {
			if (count < 1) throw new Error("Count must be at least 1");
			const queues = Array.from({ length: count }, () => {
				const q = new Superqueue();
				q.#concurrency = this.#concurrency;
				return q;
			});
			this.consume((v) => queues.map((q) => q.push(v))).finally(() => queues.map((q) => q.end()));
			return queues;
		};
		this.collect = async () => {
			const arr = [];
			await this.consume((e) => arr.push(e));
			return arr;
		};
		[this.#prom, this.#resolveNext] = Superqueue.#freshGate();
		[this.#endProm, this.#resolveEnd] = Superqueue.#freshGate();
		[this.#shiftProm, this.#resolveShift] = Superqueue.#freshGate();
	}
	static #freshGate(resolveOld) {
		resolveOld === null || resolveOld === void 0 || resolveOld();
		let resolve;
		return [new Promise((r) => resolve = r), resolve];
	}
	#run() {
		[this.#prom, this.#resolveNext] = Superqueue.#freshGate(this.#resolveNext);
	}
	#waitForPush() {
		return this.#prom || Promise.resolve();
	}
	#shift = async () => {
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
				return this.#queue.shift();
			} finally {
				[this.#shiftProm, this.#resolveShift] = Superqueue.#freshGate(this.#resolveShift);
			}
		}
	};
	/**
	* Creates a new queue from an array of values.
	* @param array The array to create the queue from.
	* @returns A new queue containing the values from the array.
	*/
	static fromArray(array) {
		const queue = new Superqueue();
		for (const item of array) queue.push(item);
		queue.end();
		return queue;
	}
	#preparePipe() {
		if (this.piped) throw new Error("Superqueue already piped");
		this.piped = true;
	}
};
//#endregion
exports.Superqueue = Superqueue;
