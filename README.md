A small zero-dependency queues library that lets you create complex async tasks pipelines using interconnected queues.

Think of it like multiple airport counters with queues of people structured to minimize average waiting time.

### Installation

```bash
# yarn
yarn add superqueue@https://github.com/libkakashi/superqueue

# npm
npm i https://github.com/libkakashi/superqueue
```

### Example Usage

```tsx
const videosQueue = await youtube.getChannelVideos(channelId); // Queue<VideoSnippetResponse>
const dbVideos = await prisma.video.findMany({where: {channelId}});

const dbVideosIndex = dbVideos.reduce(
  (acc, video) => ({[video.id]: video, ...acc}),
  {} as {[key: string]: Video}
);
const idsQueue = videosQueue.pipe(video => video.resourceId!.videoId!);

const [filteredIdsQueue, cachedIdsQueue] = ignoreCache
  ? [idsQueue.pipe(videoId => ({videoId})), Queue.fromArray([])]
  : idsQueue
      .pipe(videoId => {
        if (!dbVideosIndex[videoId]) return videoId;
        logger.info(`Already commited ${videoId}`);
        return undefined;
      })
      .usplit(async videoId => {
        if (await storage.exists(`transcript/${videoId}.vtt`)) {
          logger.info(`Found transcript for ${videoId} in cache`);
          return [{videoId}, 1];
        }
        return [{videoId}, 0];
      }, 16);

type BaseQueueData = {videoId: string; metadata: VideoMetadata};

const getMetadatas = async (ids: string[]) => {
  const metadatas = await youtube.getVideosMetadata(ids);
  return metadatas.map((metadata, i) => ({videoId: ids[i], metadata}));
};

const metadatasQueue = filteredIdsQueue
  .batch(50)
  .upipe(batch => getMetadatas(batch.map(({videoId}) => videoId)))
  .flat();

const cachedMetadatasQueue = cachedIdsQueue
  .batch(50)
  .upipe(batch => getMetadatas(batch.map(({videoId}) => videoId)))
  .flat();

const [englishVideosQueue, otherVideosQueue] = metadatasQueue.split(
  ({videoId, metadata}) => {
    if (
      !metadata.defaultAudioLanguage ||
      englishLangCodes.includes(
        metadata.defaultAudioLanguage as EnglishLangCode
      )
    ) {
      return [{videoId, metadata}, 0];
    }
    logger.warn(`Skipping ${videoId} - ${metadata.defaultAudioLanguage}`);
    return [{videoId, metadata}, 1];
  }
);

const [goodSubtitlesQueue, badSubtitlesQueue] = englishVideosQueue.usplit<
  BaseQueueData & {transcriptPath: string},
  BaseQueueData
>(async ({videoId, metadata}) => {
  try {
    const data = {
      videoId: videoId,
      metadata: metadata,
      transcriptPath: await youtube.downloadSubtitles(videoId),
    };
    return [data, 0];
  } catch (e) {
    logger.error((e as Error).message);
    return [{videoId, metadata}, 1];
  }
}, 8);

// handle goodSubtitlesQueue and badSubtitlesQueue
```

### Class: `Queue<T>`

### Constructors

- **`constructor()`**: Creates a new Queue instance.

### Methods

- **`push(...vals: T[]): void`**: Adds items to the queue.
- **`end(): void`**: Marks the queue as ended.
- **`waitForEnd(): Promise<void>`**: Returns a promise that resolves when the queue ends.
- **`collect(): Promise<T[]>`**: Returns all queue elements as an array.

  ```tsx
  const myQueue = new Queue<number>();

  myQueue.collect().then(console.log);

  myQueue.push(1, 2, 3, 4);
  await sleep(1000);
  myQueue.push(5, 6, 7, 8);

  myQueue.end();

  // Output: [1, 2, 3, 4, 5, 6, 7, 8]
  ```

- **`pushCount(): number`**: Returns number of items pushed.

  ```tsx
  const myQueue = new Queue<string>();

  myQueue.push('apple');
  console.log(myQueue.pushCount()); // 1

  myQueue.push('banana');
  console.log(myQueue.pushCount()); // 2
  ```

- **`size(): number`**: Returns current queue size.

  ```tsx
  const myQueue = new Queue<string>();

  myQueue.push('apple', 'banana');
  myQueue.end();

  console.log(myQueue.size()); // 2
  await myQueue.map(item => item); // consume queue
  console.log(myQueue.size()); // 0
  ```

- **`map(callback: (v: T) => void): Promise<void>`**: Applies callback to each queue item.

  ```tsx
  const stringQueue = new Queue<string>();

  stringQueue.push('apple');
  stringQueue.map(item => console.log(item.toUpperCase()));
  stringQueue.push('banana', 'cherry');

  // Output: APPLE, BANANA, CHERRY
  ```

- **`pipe<U>(callback: (v: T) => U | undefined): Queue<U>`**: Transforms queue elements.

  ```tsx
  const numberQueue = Queue.fromArray([1, 2, 3, 4, 5]);

  const filteredQueue = numberQueue.pipe(num =>
    num % 2 !== 0 ? num * 2 : undefined
  );

  filteredQueue.collect().then(console.log); // [2, 6, 10]
  ```

- **`split<U, V = U>(callback: (v: T) => [U, 0] | [V, 1]): [Queue<U>, Queue<V>]`**: Splits the queue.

  ```tsx
  const queue = Queue.fromArray([1, 2, 3, 4, 5, 6]);

  const [evenQueue, oddQueue] = queue.split(num =>
    num % 2 === 0 ? [num, 0] : [num, 1]
  );

  evenQueue.collect().then(array => console.log('Even:', array));
  oddQueue.collect().then(array => console.log('Odd:', array));

  // Output: Even: [2, 4, 6], Odd: [1, 3, 5]
  ```

### Concurrency Methods

- **`mapParallel(callback: (v: T) => Promise<void>, n: number = 8): Promise<void>`**: Processes items in parallel.

  ```tsx
  const asyncQueue = Queue.fromArray([1, 2, 3, 4, 5, 6, 7, 8]);

  asyncQueue.mapParallel(async item => {
    await sleep(1000);
    console.log(`Processed ${item}`);
  }, 4); // Processes 4 items in parallel
  ```

- **`upipe<U>(callback: (v: T) => Promise<U | undefined>, n: number = 8): Queue<U>`**: Unordered parallel pipe.
- **`usplit<U, V = U>(callback: (v: T) => Promise<[U, 0] | [V, 1] | undefined>, n: number = 8): [Queue<U>, Queue<V>]`**: Unordered parallel split.
- **`umerge(q: Queue<T>): Queue<T>`**: Unordered merge.

  ```tsx
  const queue1 = new Queue<number>();
  const queue2 = new Queue<number>();

  queue1.push(1, 2);
  queue2.push(3, 4);

  queue1.end();
  queue2.end();

  const mergedQueue = queue1.umerge(queue2);
  const mergedArray = await mergedQueue.collect();
  console.log(mergedArray); // [1, 2, 3, 4]
  ```

### Batching Methods

- **`batch(n: number): Queue<T[]>`**: Groups elements into batches.

  ```tsx
  const batchQueue = Queue.fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const batchedQueue = batchQueue.batch(3);
  batchedQueue.map(batch => console.log(batch));

  // Output: [1, 2, 3], [4, 5, 6], [7, 8, 9], [10]
  ```

- **`flat(): Queue<T extends Array<infer U> ? U : never>`**: Flattens array elements.

  ```tsx
  const batchQueue = new Queue<number>();
  batchQueue.push(1, 2, 3);

  const outQueue = batchQueue
    .batch(3)
    .upipe(async array => array.map(a => a * 2))
    .flat();

  outQueue.map(res => console.log(res)); // 2, 4, 6
  ```

### Properties

- **`ended: boolean`**: Whether the queue has ended.
- **`piped: boolean`**: Whether the queue has been piped.

### Static Methods

- **`static fromArray<T>(array: Array<T>): Queue<T>`**: Creates queue from array.
