Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/index.ts
let _Symbol$asyncIterator;
const EOF = void 0;
var Superqueue = class Superqueue {
	static #_ = _Symbol$asyncIterator = Symbol.asyncIterator;
	static #_2 = this.EOF = void 0;
	#queue = [];
	#prom = null;
	#endProm;
	#resolveNext = null;
	#resolveEnd = null;
	#pushCount = 0;
	#shiftResolvers = [];
	static #batchCount = 8;
	constructor() {
		this.ended = false;
		this.piped = false;
		this.waitForShift = () => new Promise((resolve) => this.#shiftResolvers.push(resolve));
		this.waitForEnd = () => this.#endProm;
		this.size = () => this.#queue.length;
		this.pushCount = () => this.#pushCount;
		this.push = (...vals) => {
			if (this.ended) throw new Error("Superqueue has ended");
			if (vals.some((val) => val === EOF)) throw new Error("Value can't be undefined. Please use null.");
			this.#pushCount += vals.length;
			this.#queue.push(...vals);
			this.#run();
		};
		this.end = () => {
			if (this.ended) throw new Error("Superqueue has ended");
			this.#queue.push(EOF);
			this.#run();
			this.ended = true;
			this.#resolveEnd();
		};
		this.shiftUnsafe = () => this.#shift();
		this[_Symbol$asyncIterator] = async function* () {
			this.#preparePipe();
			for (let r = await this.#shift(); r !== EOF; r = await this.#shift()) yield r;
		};
		this.map = async (callback) => {
			this.#preparePipe();
			for (let r = await this.#shift(); r !== EOF; r = await this.#shift()) callback(r);
		};
		this.mapParallel = async (callback, n = Superqueue.#batchCount) => {
			this.#preparePipe();
			let proms = [];
			while (true) {
				if (proms.length === n) {
					const { index } = await Promise.race(proms.map(async (p, index) => ({
						v: await p,
						index
					})));
					proms = proms.filter((_, i) => i !== index);
				}
				const r = await this.#shift();
				if (r === EOF) break;
				proms.push(callback(r));
			}
			if (proms.length > 0) await Promise.allSettled(proms);
		};
		this.pipe = (callback) => {
			const outSuperqueue = new Superqueue();
			const c = (v) => {
				const r = callback(v);
				if (r !== void 0) outSuperqueue.push(r);
			};
			this.map(c).then(outSuperqueue.end);
			return outSuperqueue;
		};
		this.upipe = (callback, n = Superqueue.#batchCount) => {
			const outSuperqueue = new Superqueue();
			const c = async (v) => {
				const r = await callback(v);
				if (r !== void 0) outSuperqueue.push(r);
			};
			this[n === Infinity ? "map" : "mapParallel"](c, n).then(outSuperqueue.end);
			return outSuperqueue;
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
			this.map(c).then(() => {
				q1.end();
				q2.end();
			});
			return [q1, q2];
		};
		this.batch = (n) => {
			const outSuperqueue = new Superqueue();
			let buffer = [];
			this.map((v) => {
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
		this.flat = () => {
			const outSuperqueue = new Superqueue();
			this.map((v) => {
				if (v instanceof Array) outSuperqueue.push(...v);
				else throw new Error("Value is not an array");
			}).then(outSuperqueue.end);
			return outSuperqueue;
		};
		this.usplit = (callback, n = Superqueue.#batchCount) => {
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
			this[n === Infinity ? "map" : "mapParallel"](c, n).then(() => {
				q1.end();
				q2.end();
			});
			return [q1, q2];
		};
		this.umerge = (q) => {
			const outSuperqueue = new Superqueue();
			Promise.all([this, q].map((q) => q.map(outSuperqueue.push))).then(outSuperqueue.end);
			return outSuperqueue;
		};
		this.clone = (count = 2) => {
			if (count < 1) throw new Error("Count must be at least 1");
			const queues = Array.from({ length: count }, () => new Superqueue());
			this.map((v) => queues.map((q) => q.push(v))).then(() => queues.map((q) => q.end()));
			return queues;
		};
		this.collect = async () => {
			const arr = [];
			await this.map((e) => arr.push(e));
			return arr;
		};
		this.#prom = new Promise((resolve) => this.#resolveNext = resolve);
		this.#endProm = new Promise((resolve) => this.#resolveEnd = resolve);
	}
	#run() {
		var _this$resolveNext;
		(_this$resolveNext = this.#resolveNext) === null || _this$resolveNext === void 0 || _this$resolveNext.call(this);
		this.#prom = new Promise((resolve) => this.#resolveNext = resolve);
	}
	#waitForPush() {
		return this.#prom || Promise.resolve();
	}
	#shift = async () => {
		if (this.size() === 0) {
			if (this.ended) return EOF;
			await this.#waitForPush();
			return await this.#shift();
		}
		try {
			return this.#queue.shift();
		} finally {
			this.#shiftResolvers.map((r) => r());
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
