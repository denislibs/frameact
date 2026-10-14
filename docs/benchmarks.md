# Benchmarks — results

A summary of every benchmark run so far, so the numbers survive without the benchmark checkouts. The harnesses stay in
`bench/` and can be re-run (commands at the end); raw data of the latest runs is in `bench/*/results/`.

Machine for all runs: Apple M1 Pro (10 cores, 16 GB), macOS 26.5, Node 24.3. Several runs were taken on a loaded machine;
the load average is given where it was recorded. Ratios are only comparable **within one run**.

## Reactive graph — js-reactivity-benchmark

[js-reactivity-benchmark](https://github.com/transitive-bullshit/js-reactivity-benchmark) at `2c273f1`, frameact through
its public API (`createSignal` / `createMemo` / `createEffect(fn, noop)` / `createRoot`, `flushSync()` at the batch
boundary on the default `tickEnd` scheduler — what an app pays). Value: geometric mean of each case's time divided by the
fastest engine on that case; lower is better; there is no overall score.

### Latest full run (2026-10-12, after the core perf pass, PR #12)

| Engine | kairo | mol | s | dynamic | cellx |
| --- | ---: | ---: | ---: | ---: | ---: |
| alien-signals 3.2.1 | 1.01× | 1.35× | 1.02× | 1.00× | 1.00× |
| Preact Signals 1.14 | 1.28× | 1.36× | 1.28× | 1.32× | 2.43× |
| **frameact** | **1.65×** | **1.35×** | **1.63×** | **1.38×** | 3.36× |
| @vue/reactivity 3.5 | 2.11× | 1.36× | 1.50× | 1.67× | 2.82× |
| Oby 15 | 2.24× | 1.63× | 3.36× | 1.99× | 3.26× |
| @angular/signals 22 | 3.37× | 1.38× | 2.43× | 2.91× | 2.43× |
| SolidJS (`@solidjs/signals` 2.0 rc) | 3.96× | 1.64× | 2.72× | 3.40× | 1.97× |
| Svelte 5 | 4.23× | 1.40× | 2.78× | 2.22× | 142.85× |
| MobX 7 | 3.83× | 1.38× | 3.59× | 2.64× | 4.84× |

(`mol` is flat because `$mol_wire` is the fastest there; `cellx` timings are microseconds and noisy.)

### How frameact got there

| frameact build | kairo | s | dynamic |
| --- | ---: | ---: | ---: |
| first adapter (maverick core, 2026-10-11) | 3.04× | 2.95× | 2.08× |
| core reworked after alien-signals (PR #5) | 2.08× | 1.83× | 1.52× |
| core perf pass (PR #12) | 1.65× | 1.63× | 1.38× |
| memory & bundle pass (PR #15, spot check) | 1.51× | 1.53× | — |

PR #12 in numbers: `avoidablePropagation` 341 → ~147 ms, "1 signal → 1 effect + flush" 170 → 96 ns (`bench/store`). Why
not Preact level on kairo / s: the remaining gap is spread across the core (owner cleanup per recompute, two-phase effects,
store-parking cause tags) with no hot spot; experiments that removed semantics gained 0–3 % each and were rejected
(`docs/superpowers/plans/2026-10-15-core-perf.md`).

## DOM runtime — krausest js-framework-benchmark (keyed)

[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) at `bf894b6`, frameact keyed implementation in
`bench/krausest/frameworks/keyed/frameact` (`frameact` + `frameact/dom`, keyed `<For>`, `createSelector`, delegated events).
Local run, Chrome 155 (window, not headless), upstream defaults (15 CPU iterations, 1 for memory and size); load average
6.6–18.7 before, 9.1 after. **Not the official table** — frameact is not on npm, so it cannot be submitted yet. Upstream's
correctness checks (smoketest, `isKeyed`, CSP) pass.

### Latest run (2026-10-13, after the memory & bundle pass, PR #15)

Geometric mean of each row's ratio to the best framework in the run; lower is better.

| Framework | CPU (weighted) | memory | brotli, KB | first paint, ms |
| --- | ---: | ---: | ---: | ---: |
| vanillajs | 1.02 | 1.00 | 2.5 | 59.6 |
| solid 1.9.3 | 1.12 | 1.21 | 4.5 | 60.3 |
| **frameact** | **1.13** | **1.45** | **12.2** | **100.1\*** |
| svelte 5.42.1 | 1.15 | 1.40 | 9.7 | 95.3 |
| vue 3.5.39 | 1.26 | 1.80 | 23.3 | 121.8 |
| preact-signals 11 + 2.3.1 | 1.42 | 3.54 | 8.3 | 68.7 |
| preact-hooks 11 | 1.52 | 1.32 | 5.9 | 72.9 |

\* One sample on a loaded machine. The median of 7 with `bench/krausest/heap.mjs` is 83 ms. The first-paint gap to Solid
is mostly the upstream server compressing each response with synchronous brotli q11 (~1 ms per KB), i.e. bundle size;
`render()` mounts synchronously.

CPU, median ms (ratio to the best in the row):

| | vanillajs | solid | **frameact** | svelte | vue |
| --- | ---: | ---: | ---: | ---: | ---: |
| create rows | 30.4 (1.00) | 32.7 (1.08) | 36.2 (1.19) | 33.2 (1.09) | 36.3 (1.19) |
| replace all rows | 36.3 (1.00) | 36.9 (1.02) | 38.5 (1.06) | 40.6 (1.12) | 46.0 (1.27) |
| partial update | 20.3 (1.00) | 26.4 (1.30) | 25.8 (1.27) | 23.8 (1.17) | 25.2 (1.24) |
| select row | 6.1 (1.00) | 7.6 (1.25) | 8.1 (1.33) | 10.7 (1.75) | 8.8 (1.44) |
| swap rows | 24.6 (1.00) | 28.1 (1.14) | 30.1 (1.22) | 28.0 (1.14) | 27.3 (1.11) |
| remove row | 19.4 (1.13) | 20.7 (1.20) | **17.2 (1.00)** | 19.6 (1.14) | 24.0 (1.40) |
| create many rows | 329.0 (1.00) | 356.2 (1.08) | 366.2 (1.11) | 365.3 (1.11) | 382.4 (1.16) |
| append rows to large table | 39.7 (1.04) | 38.2 (1.00) | 43.9 (1.15) | 43.0 (1.13) | 46.2 (1.21) |
| clear rows | 17.7 (1.01) | 20.1 (1.14) | **17.6 (1.00)** | 20.2 (1.15) | 24.6 (1.40) |

Memory, MB: ready 0.75 (Solid 0.60), 1k rows 2.80 (Solid 2.68), after create/clear 1k ×5 0.99 (Solid 0.76).

### The memory & bundle pass (PR #15)

| | before | after | Solid |
| --- | ---: | ---: | ---: |
| bundle (krausest app, brotli) | 14.75 KB | 12.3 KB | 4.5 KB |
| memory geomean | 1.55 | 1.45 | 1.21 |
| JS heap per 1k rows (heap snapshot) | 11 294 KB | 10 962 KB | 11 074 KB |
| retained after create/clear ×5 | +439 KB | +364 KB | +299 KB |
| first paint (median of 7) | 98 ms | 83 ms | ~57 ms |
| CPU geomean | 1.11 | 1.13 (noise) | 1.12 |

What changed: controlled inputs became tree-shakeable (registered by the Vite/Babel plugin only where used), class state
without a per-element `Set`, graph-node fields kept in-object, heavy-animation gating installed on first use,
`<ManualFor>` split out of `For`. No leak was found: frame queues and pools retain nothing; the retained rest is a V8
`WeakMap` table that never shrinks plus JIT code. The remaining bundle gap to Solid is the core itself (frame phases,
gating, store parking, DOM natives, the attribute security policy).

## Micro-benchmarks

- `bench/store` (production bundle, one process per bench): "1 signal → 1 effect + flush" 174 → 97 ns (PR #12);
  `Object.values` over a 1000-key store proxy 816 → 470 µs and `values()` 39 µs (store fix round); 50 messages prepended
  through `produce` 727 → ~160 µs; a closed 1000-message chat retains 783 → 346 KB.
- `bench/store/st-adopt.bench.ts` — `adopt()` stops at store-owned containers (PR #19): replace a 1000-key dictionary with
  999 children reused 0.55 → 0.12 ms; a fresh 5k result set referencing live messages (50k tree) 6.0 → 1.7 ms; 200 new
  messages into a 50k dictionary 74 → 9.3 ms; `st-prepend` / `st-list` / `st-reconcile` unchanged. Cost: ≈35 B per
  container (~+8 MB for a ~356k-object state, +16 MB after one full reload), a full reload by replacement 45–55 →
  133–165 ms, writing only-new objects +25–30 % — prefer `reconcile` for full loads and `merge` / path writes for
  dictionaries.
- `bench/dom` (vitest benches): `reconcile`, spread, manual-order lists — no regressions across PRs #12–#15.

## Re-running

```bash
pnpm bench:reactivity                  # js-reactivity-benchmark, ~10 min (clones upstream into bench/reactivity/.upstream)
node bench/reactivity/run.mjs --check  # adapter correctness only (also weekly in CI)
pnpm bench:krausest                    # krausest, ~40 min, opens Chrome windows (clones upstream into bench/krausest/.upstream)
node bench/krausest/heap.mjs --fp 7    # first paint / memory / heap snapshots
node bench/store/run.mjs [filter]      # store/core micro-benches
pnpm exec vitest run --config bench/dom/vitest.config.ts
```

Record `uptime` with every run; on a loaded machine repeat a run that looks off.
