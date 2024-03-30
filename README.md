### Class: `Queue<T>`

### Constructors

- **`constructor()`**: Initializes a new instance of the `Queue` class.

### Methods

- **`push(...vals: T[]): void`**: Pushes one or more values onto the queue.
- **`end(): void`**: Marks the queue as ended.
- **`waitForEnd(): Promise<void>`**: Returns a promise that resolves when the queue ends.
- **collect`(): Promise<T[]>`**: Converts the queue into an array. Collects all elements of the queue into an array and returns a promise that resolves to this array when the queue ends.
    
    ```tsx
    const myQueue = new Queue<number>();
    
    myQueue.collect().then(console.log);
    
    // Pushing values into the queue
    myQueue.push(1, 2, 3, 4);
    await sleep(1000);
    myQueue.push(5, 6, 7, 8);
    
    myQueue.end();
    console.log('Queue ended');
    
    // Output: 
    // Queue ended
    // [1, 2, 3, 4, 5, 6, 7, 8]
    ```
    
- **`pushCount(): number`**: Returns the number of items that have been pushed into the queue.
    
    ```tsx
    const myQueue = new Queue<string>();
    
    myQueue.push("apple");
    console.log(myQueue.pushCount());
    
    myQueue.push("banana");
    console.log(myQueue.pushCount());
    
    // Output:
    // 1
    // 2
    ```
    
- **`size(): number`**: Returns the current size of the queue.
    
    ```tsx
    const myQueue = new Queue<string>();
    
    myQueue.push("apple", "banana");
    myQueue.end();
    
    console.log('Size before consuming:', myQueue.size());
    console.log('Push count before consuming:', myQueue.pushCount()); 
    
    await myQueue.map(_ = _); // consume the queue
    
    console.log('Size after consuming:', myQueue.size());
    console.log('Push count after consuming:', myQueue.pushCount()); 
    
    // Output:
    // Size before consuming: 2
    // Push count before consuming: 2
    // Size after consuming: 0
    // Push count after consuming: 2
    ```
    
- **`map(callback: (v: T) => void): Promise<void>`**: Applies the provided callback function to each item in the queue.
    
    ```tsx
    const stringQueue = new Queue<string>();
    
    stringQueue.push("apple");
    
    // Applying a callback to each item
    stringQueue.map(item => console.log(item.toUpperCase()));
    
    stringQueue.push("banana", "cherry");
    
    // Output:
    // APPLE
    // BANANA
    // CHERRY
    ```
    
- **`pipe<U>(callback: (v: T) => U | undefined): Queue<U>`**: Transforms the queue's elements using the given callback function and returns a new queue with the transformed elements.
    
    ```tsx
    const numberQueue = Queue.fromArray([1, 2, 3, 4, 5]);
    
    // Processing items and filtering out even numbers
    const filteredQueue = numberQueue.pipe(num => {
      if (num % 2 !== 0) {
        return num * 2; // Double all odd numbers
      }
    	// Drop all even numbers
    	return undefined;
    });
    
    filteredQueue.collect().then(console.log); // Output: [2, 6, 10]
    ```
    
- **`split<U, V = U>(callback: (v: T) => [U, 0] | [V, 1]): [Queue<U>, Queue<V>]`**: Splits the queue into two separate queues based on a callback function.
    
    ```tsx
    const queue = Queue.fromArray([1, 2, 3, 4, 5, 6]);
    
    // Splitting the queue into even and odd numbers
    const [evenQueue, oddQueue] = queue.split(num => {
      return num % 2 === 0 ? [num, 0] : [num, 1];
    });
    
    evenQueue.toArray().then(array => console.log("Even:", array));
    oddQueue.toArray().then(array => console.log("Odd:", array));
    
    // Output: 
    // Even: [2, 4, 6]
    // Odd: [1, 3, 5]
    ```
    

### Concurrency Methods

- **`mapParallel(callback: (v: T) => Promise<void>, n: number = 8): Promise<void>`**: Similar to `map`, but processes items in parallel up to `n` at a time. The `n+1`th call is made when any one of the first `n` calls finishes, such that there are always `n` calls running in parallel.
    
    ```tsx
    const asyncQueue = Queue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
    
    let lastTimestamp = Date.now();
    
    asyncQueue.mapParallel(async item => {
      await sleep(1000);
    
      const newTimestamp = Date.now();
      console.log(`Processed ${item} in ${newTimestamp - lastTimestamp}ms`);
    
      lastTimestamp = newTimestamp;
    }, 4);
    
    // Output:
    // Processed 1 in 1004ms
    // Processed 2 in 5ms
    // Processed 3 in 1ms
    // Processed 4 in 0ms
    // Processed 5 in 999ms
    // Processed 6 in 6ms
    // Processed 7 in 0ms
    // Processed 8 in 0ms
    ```
    
- **`upipe<U>(callback: (v: T) => Promise<U | undefined>, n: number = 8): Queue<U>`**: Unordered version of `pipe`, processing items in parallel.
- **`usplit<U, V = U>(callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>, n: number = 8): [Queue<U>, Queue<V>]`**: Unordered version of `split`, processing items in parallel and splitting them into two queues based on a callback function.
- **`umerge(q: Queue<T>): Queue<T>`**: Merges the current queue with another queue in an unordered manner.
    
    ```tsx
    const queue1 = new Queue<number>();
    const queue2 = new Queue<number>();
    
    queue1.push(1);
    queue1.push(2);
    queue2.push(3);
    queue2.push(4);
    
    queue1.end();
    queue2.end();
    
    const mergedQueue = queue1.umerge(queue2);
    
    const mergedArray = await mergedQueue.collect();
    console.log('Merged Array:', mergedArray);
    
    // Output:
    // Merged Array: [1, 2, 3, 4]
    ```
    

### Batching Methods

- **`batch(n: number): Queue<T[]>`**: Groups the queue's elements into batches of size `n`.
    
    ```tsx
    const batchQueue = Queue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    
    // Creating batches of size 3
    const batchedQueue = batchQueue.batch(3);
    
    batchedQueue.map(batch => console.log(batch));
    
    // Output:
    // [1, 2, 3]
    // [4, 5, 6]
    // [7, 8, 9]
    // [10]
    ```
    
- **`flat(): Queue<T extends Array<infer U> ? U : never>`**: Flattens the queue's elements if they are arrays.
    
    ```tsx
    const batchQueue = new Queue<number>();
    batchQueue.push(1, 2, 3);
    
    const asyncBatchCall = async (array: number[]) => {
    	await sleep(1000);
    	return array.map(a => a * 2);
    };
    
    const outQueue = batchQueue.batch(3).upipe(asyncBatchCall).flat();
    
    outQueue.map(res => console.log(res));
    
    // Output:
    // 2
    // 2
    // 6
    ```
    

### Properties

- **`ended: boolean`**: Indicates whether the queue has ended.
- **`piped: boolean`**: Indicates whether the queue has been piped.

### Static Methods

- **`static fromArray<T>(array: Array<T>): Queue<T>`**: Creates a new queue from an array. The queue is ended at the time of creation itself. Further elements cannot be pushed.

### Notes

- Methods that start with `u` (e.g., `upipe`, `usplit`, `umerge`) are unordered methods, which means the order of elements is lost going from the input queue to the output queue. You're **not** supposed to make **any assumptions at all** about the order of the elements.
- It's very easy to inadvertently misuse the queues or overlook certain error conditions. Please be very cautious while handling errors, especially with the unordered methods.
