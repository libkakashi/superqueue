// Manual integration test for pipeline-closes-on-user-throw.
//
// Bun's test runner fails tests on unhandled rejections through a path
// that process.on('unhandledRejection') can't intercept, so this lives
// outside bun test. Run with: `bun test/error-pipeline-manual.ts`.
//
// What we're verifying: when a user callback throws mid-pipeline, the
// output queue still closes (instead of silently hanging forever) and
// consumers receive whatever was produced before the throw.

import {Superqueue} from '../src';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Swallow unhandled rejections at the process level. User errors
// escaping as unhandled is the intended semantic; we just don't want
// them to crash this harness.
process.on('unhandledRejection', () => {});

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    delay(ms).then(() => Promise.reject(new Error(`TIMEOUT: ${label}`))),
  ]);

let passed = 0;
let failed = 0;
const report = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
};

// --- pipe: sync callback throws ---
{
  const q = Superqueue.fromArray([1, 2, 3]);
  const out = q.pipe(v => {
    if (v === 2) throw new Error('boom');
    return v;
  });
  try {
    const result = await withTimeout(out.collect(), 500, 'pipe collect');
    report(
      'pipe: sync throw — output closes with partial items',
      result.length === 1 && result[0] === 1 && out.ended,
      `got ${JSON.stringify(result)}, ended=${out.ended}`,
    );
  } catch (e) {
    report('pipe: sync throw', false, (e as Error).message);
  }
}

// --- upipe: async callback rejects ---
{
  const q = Superqueue.fromArray([1, 2, 3, 4]);
  const out = q.upipe(async v => {
    if (v === 3) throw new Error('boom');
    return v;
  });
  try {
    await withTimeout(out.collect(), 500, 'upipe collect');
    report('upipe: async reject — output closes', out.ended);
  } catch (e) {
    report('upipe: async reject', false, (e as Error).message);
  }
}

// --- split: routing callback throws — both outputs close ---
{
  const q = Superqueue.fromArray([1, 2, 3]);
  const [a, b] = q.split<number>(v => {
    if (v === 2) throw new Error('boom');
    return v % 2 === 0 ? [v, 0] : [v, 1];
  });
  try {
    await withTimeout(
      Promise.all([a.collect(), b.collect()]),
      500,
      'split collect',
    );
    report(
      'split: throw — both outputs close',
      a.ended && b.ended,
      `a.ended=${a.ended}, b.ended=${b.ended}`,
    );
  } catch (e) {
    report('split: throw', false, (e as Error).message);
  }
}

// --- usplit: async routing throws — both outputs close ---
{
  const q = Superqueue.fromArray([1, 2, 3, 4]);
  const [a, b] = q.usplit<number>(async v => {
    if (v === 3) throw new Error('boom');
    return v % 2 === 0 ? [v, 0] : [v, 1];
  });
  try {
    await withTimeout(
      Promise.all([a.collect(), b.collect()]),
      500,
      'usplit collect',
    );
    report('usplit: throw — both outputs close', a.ended && b.ended);
  } catch (e) {
    report('usplit: throw', false, (e as Error).message);
  }
}

// --- flat: non-array value throws — output closes ---
{
  const q = Superqueue.fromArray<number[] | number>([[1, 2], 99 as never, [3]]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = (q as any).flat();
  try {
    await withTimeout(out.collect(), 500, 'flat collect');
    report('flat: non-array — output closes', out.ended);
  } catch (e) {
    report('flat: non-array', false, (e as Error).message);
  }
}

// --- clone: one clone ended externally — source consume throws — other clones close ---
{
  const q = Superqueue.fromArray([1, 2, 3]);
  const [a, b] = q.clone(2);
  a.end(); // force push-after-end inside source's consume
  try {
    await withTimeout(b.collect(), 500, 'clone collect');
    report('clone: internal throw — all clones end', a.ended && b.ended);
  } catch (e) {
    report('clone: internal throw', false, (e as Error).message);
  }
}

// --- umerge: one upstream throws — merged output closes ---
{
  const a = Superqueue.fromArray([1, 2, 3]);
  const b = Superqueue.fromArray([4, 5, 6]);
  const bBad = b.pipe(v => {
    if (v === 5) throw new Error('boom');
    return v;
  });
  const merged = a.umerge(bBad);
  try {
    await withTimeout(merged.collect(), 500, 'umerge collect');
    report('umerge: upstream throw — merged closes', merged.ended);
  } catch (e) {
    report('umerge: upstream throw', false, (e as Error).message);
  }
}

// --- pipe chain: mid-chain throw closes everything downstream ---
{
  const q = Superqueue.fromArray([1, 2, 3]);
  const step1 = q.pipe(v => v * 2);
  const step2 = step1.pipe(v => {
    if (v === 4) throw new Error('boom');
    return v;
  });
  const step3 = step2.pipe(v => v + 1);
  try {
    await withTimeout(step3.collect(), 500, 'chain collect');
    report(
      'pipe chain: mid-chain throw closes all downstream',
      step1.ended && step2.ended && step3.ended,
    );
  } catch (e) {
    report('pipe chain: mid-chain throw', false, (e as Error).message);
  }
}

// Summary
console.log('');
if (failed === 0) {
  console.log(`All ${passed} checks passed.`);
  process.exit(0);
} else {
  console.error(`${failed} check(s) failed (${passed} passed).`);
  process.exit(1);
}
