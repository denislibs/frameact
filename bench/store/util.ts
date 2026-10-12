import { DEV } from '../../src/env';

if (DEV) throw new Error('benchmarks must run with DEV = false');

export function median(xs: number[]) {
  return [...xs].sort((a, b) => a - b)[xs.length >> 1];
}

/** Median over `batches` batches of `ops` calls of fn(k), after `warm` calls; ns per op. */
export function nsPerOp(fn: (k: number) => void, { ops = 1000, batches = 9, warm = 2000 } = {}) {
  let k = 0;
  for (; k < warm; k++) fn(k);
  const samples: number[] = [];
  for (let b = 0; b < batches; b++) {
    (globalThis as any).gc();
    const t0 = performance.now();
    for (let i = 0; i < ops; i++) fn(k++);
    samples.push(((performance.now() - t0) * 1e6) / ops);
  }
  return median(samples);
}

/** Median of `runs` single timings (ms) of fn(), each after setup() (untimed). */
export function msOnce(setup: () => unknown, fn: (ctx: any) => void, { runs = 15, warm = 5, teardown }: { runs?: number; warm?: number; teardown?: (ctx: any) => void } = {}) {
  const samples: number[] = [];
  for (let r = 0; r < warm + runs; r++) {
    const ctx = setup();
    (globalThis as any).gc();
    const t0 = performance.now();
    fn(ctx);
    const dt = performance.now() - t0;
    teardown?.(ctx);
    if (r >= warm) samples.push(dt);
  }
  return median(samples);
}

export function heap() {
  const g = (globalThis as any).gc;
  g(); g(); g();
  return process.memoryUsage().heapUsed;
}

export function report(name: string, value: number, unit: string, extra = '') {
  const v = value < 10 ? value.toFixed(2) : value.toFixed(1);
  process.stdout.write(`| ${name} | ${v} ${unit} |${extra ? ` ${extra}` : ''}\n`);
}
