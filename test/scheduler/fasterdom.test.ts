import {
  requestMeasure, requestMutation, requestNextMutation, requestForcedReflow,
  flushSync, getPhase,
} from '../../src/scheduler/fasterdom';
import { installFakeRaf } from '../helpers/raf';
import { flushMicrotasks } from '../helpers/micro';

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(async () => {
  // Drain the throttled rAF so module-level scheduling state does not leak into the next test.
  while (raf.pending()) {
    raf.frame();
    await flushMicrotasks();
  }
  raf.uninstall();
});

async function frame() { raf.frame(); await flushMicrotasks(); }

it('runs measure → mutate → forced-reflow measure → forced-reflow mutate in one frame', async () => {
  const log: string[] = [];
  requestMutation(() => log.push('mutate:' + getPhase()));
  requestMeasure(() => log.push('measure:' + getPhase()));
  requestForcedReflow(() => {
    log.push('reflow-measure:' + getPhase());
    return () => log.push('reflow-mutate:' + getPhase());
  });
  expect(raf.pending()).toBe(1);
  await frame();
  expect(log).toEqual([
    'measure:measure', 'mutate:mutate', 'reflow-measure:measure', 'reflow-mutate:mutate',
  ]);
  expect(getPhase()).toBe('measure');
});

it('a mutation requested during the measure phase runs in the same frame', async () => {
  const log: string[] = [];
  requestMeasure(() => { log.push('m'); requestMutation(() => log.push('x')); });
  await frame();
  expect(log).toEqual(['m', 'x']);
});

it('a mutation requested during the mutate phase runs in the next frame', async () => {
  const log: string[] = [];
  requestMutation(() => { log.push('a'); requestMutation(() => log.push('b')); });
  await frame();
  expect(log).toEqual(['a']);
  await frame();
  expect(log).toEqual(['a', 'b']);
});

it('requestNextMutation defers to the mutate phase of the same frame (via a measure task)', async () => {
  const log: string[] = [];
  requestNextMutation(() => log.push('n:' + getPhase()));
  await frame();
  expect(log).toEqual(['n:mutate']);
});

it('forced-reflow tasks added during the forced-reflow pass run in the same pass', async () => {
  const log: string[] = [];
  requestForcedReflow(() => { log.push('r1'); requestForcedReflow(() => { log.push('r2'); }); });
  await frame();
  expect(log).toEqual(['r1', 'r2']);
});

it('an exception in one task does not stop the others', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log: string[] = [];
  requestMeasure(() => { throw new Error('boom'); });
  requestMeasure(() => log.push('ok'));
  await frame();
  expect(log).toEqual(['ok']);
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it('flushSync drains all four queues synchronously with correct phases', () => {
  const log: string[] = [];
  requestMutation(() => log.push('mutate:' + getPhase()));
  requestMeasure(() => log.push('measure:' + getPhase()));
  requestForcedReflow(() => { log.push('rm:' + getPhase()); return () => log.push('rx:' + getPhase()); });
  flushSync();
  expect(log).toEqual(['measure:measure', 'mutate:mutate', 'rm:measure', 'rx:mutate']);
  expect(getPhase()).toBe('measure');
});

it('flushSync is not reentrant', () => {
  // Capture outside the task: an expect() inside a task would be swallowed by the per-task try/catch.
  let thrown: unknown;
  requestMeasure(() => {
    try { flushSync(); } catch (error) { thrown = error; }
  });
  flushSync();
  expect(String(thrown)).toMatch(/reentrant/);
});

it('flushSync with nothing queued is a no-op pass: phase stays measure, listeners are not called', async () => {
  const { onPhaseChange } = await import('../../src/scheduler/fasterdom');
  const seen: string[] = [];
  const off = onPhaseChange((p) => seen.push(p));
  flushSync();
  expect(seen).toEqual([]);
  expect(getPhase()).toBe('measure');
  requestMutation(() => seen.push('task:' + getPhase()));
  flushSync();
  expect(seen).toEqual(['mutate', 'task:mutate', 'measure', 'mutate', 'measure']); // a real pass runs all four phases
  off();
});

it('flushSync inside a rAF pass segment throws instead of interleaving the phases; the pass completes', async () => {
  const log: string[] = [];
  let thrown: unknown;
  requestMeasure(() => {
    try { flushSync(); } catch (error) { thrown = error; }
    log.push('measure:' + getPhase());
  });
  requestMutation(() => log.push('mutate:' + getPhase()));
  await frame();
  expect(String(thrown)).toMatch(/not reentrant: it was called inside a frame pass/);
  expect(log).toEqual(['measure:measure', 'mutate:mutate']);
  expect(getPhase()).toBe('measure');
});

it('flushSync from a microtask between two rAF segments (a tickEnd drain) is outside the pass: it runs, draining the pending rAF work too', async () => {
  const log: string[] = [];
  requestMeasure(() => {
    // queued during the measure segment: runs before the mutate segment's microtask
    void Promise.resolve().then(() => {
      requestMutation(() => log.push('sync-mutate:' + getPhase()));
      flushSync();
      log.push('after-sync:' + getPhase());
    });
  });
  requestMutation(() => log.push('raf-mutate:' + getPhase()));
  await frame();
  // the rAF's own mutation was still pending: the sync pass took it along (FIFO); the rAF's mutate segment then found an empty queue
  expect(log).toEqual(['raf-mutate:mutate', 'sync-mutate:mutate', 'after-sync:measure']);
});
