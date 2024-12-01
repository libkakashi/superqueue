import Queue from '../src';

const queue = new Queue();

// (async () => {
//   const [v1, v2] = await Promise.all([
//     queue.shiftUnsafe(),
//     queue.shiftUnsafe(),
//   ]);
//   console.log([v1, v2]);
// })();

queue.push('1');
console.log('push one');

queue.push('2');
console.log('push two');

queue.waitForShift().then(() => console.log('1'));
queue.waitForShift().then(() => console.log('2'));

queue.shiftUnsafe();
console.log('ow');
queue.shiftUnsafe();
