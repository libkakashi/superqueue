import Queue from '../src';

const queue = new Queue<string>();

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

queue.end();

const [clone1, clone2, clone3] = queue.clone(3);

for await (const item of clone1) {
  console.log(item, 'hehe');
}
for await (const item of clone2) {
  console.log(item, 'hehe2');
}
for await (const item of clone3) {
  console.log(item, 'hehe3');
}
console.log('out');
