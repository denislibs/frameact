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
