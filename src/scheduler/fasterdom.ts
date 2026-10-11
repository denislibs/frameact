// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/lib/fasterdom/fasterdom.ts
import { fastRaf, throttleWith, type NoneToVoidFunction } from './schedulers';

export type Phase = 'measure' | 'mutate';
type ReflowTask = () => NoneToVoidFunction | void;

let phase: Phase = 'measure';
const phaseListeners = new Set<(phase: Phase) => void>();

export function getPhase(): Phase {
  return phase;
}

export function setPhase(next: Phase) {
  if (phase === next) return;
  phase = next;
  phaseListeners.forEach((listener) => listener(next));
}

/** stricterdom (plan 4) subscribes here. */
export function onPhaseChange(listener: (phase: Phase) => void) {
  phaseListeners.add(listener);
  return () => {
    phaseListeners.delete(listener);
  };
}

let pendingMeasureTasks: NoneToVoidFunction[] = [];
let pendingMutationTasks: NoneToVoidFunction[] = [];
let pendingForceReflowTasks: ReflowTask[] = [];
let inSyncPass = false;

function safeExec(fn: NoneToVoidFunction) {
  try {
    fn();
  } catch (error) {
    console.error('[frameact] scheduler task failed', error);
  }
}

function runMeasureTasks() {
  setPhase('measure');
  const current = pendingMeasureTasks;
  pendingMeasureTasks = [];
  current.forEach(safeExec);
}

function runMutationTasks() {
  setPhase('mutate');
  const current = pendingMutationTasks;
  pendingMutationTasks = [];
  current.forEach(safeExec);
}

function runForcedReflowTasks(): NoneToVoidFunction[] {
  setPhase('measure');
  const mutations: NoneToVoidFunction[] = [];
  // for..of over the live array: tasks requested during this loop are included (as in teact)
  for (const task of pendingForceReflowTasks) {
    safeExec(() => {
      const mutation = task();
      if (mutation) mutations.push(mutation);
    });
  }
  pendingForceReflowTasks = [];
  return mutations;
}

function runForcedReflowMutations(mutations: NoneToVoidFunction[]) {
  setPhase('mutate');
  mutations.forEach(safeExec);
  setPhase('measure');
}

const runUpdatePassOnRaf = throttleWith(
  (cb) => fastRaf(cb, true),
  () => {
    runMeasureTasks();
    // Promise hops keep MutationObserver microtasks ordered against our phase changes.
    void Promise.resolve()
      .then(runMutationTasks)
      .then(runForcedReflowTasks)
      .then(runForcedReflowMutations);
  },
);

export function requestMeasure(cb: NoneToVoidFunction) {
  pendingMeasureTasks.push(cb);
  runUpdatePassOnRaf();
}

export function requestMutation(cb: NoneToVoidFunction) {
  pendingMutationTasks.push(cb);
  runUpdatePassOnRaf();
}

export function requestNextMutation(cb: NoneToVoidFunction) {
  requestMeasure(() => {
    requestMutation(cb);
  });
}

export function requestForcedReflow(cb: ReflowTask) {
  pendingForceReflowTasks.push(cb);
  runUpdatePassOnRaf();
}

/** @internal core flushSync() loops until nothing is pending. */
export function hasPendingFrameTasks() {
  return pendingMeasureTasks.length > 0 || pendingMutationTasks.length > 0 || pendingForceReflowTasks.length > 0;
}

/**
 * Run a whole frame pass synchronously (tests, imperative integration code).
 * Does not bypass heavy-animation gating of the core's run queues. Not reentrant.
 * The already-throttled rAF (if any) will later fire with empty queues — harmless.
 */
export function flushSync() {
  if (inSyncPass) throw new Error('[frameact] flushSync() is not reentrant');
  inSyncPass = true;
  try {
    runMeasureTasks();
    runMutationTasks();
    runForcedReflowMutations(runForcedReflowTasks());
  } finally {
    inSyncPass = false;
    setPhase('measure');
  }
}
