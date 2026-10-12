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
/**
 * > 0 while a phase segment of a frame pass runs — a rAF segment (measure tasks, then each
 * microtask: mutations, forced-reflow measures, forced-reflow mutations) or flushSync() itself.
 * A microtask between two rAF segments (a tickEnd drain) is NOT inside a segment.
 */
let passDepth = 0;

function safeExec(fn: NoneToVoidFunction) {
  try {
    fn();
  } catch (error) {
    console.error('[frameact] scheduler task failed', error);
  }
}

function runMeasureTasks() {
  passDepth++;
  try {
    setPhase('measure');
    const current = pendingMeasureTasks;
    pendingMeasureTasks = [];
    current.forEach(safeExec);
  } finally {
    passDepth--;
  }
}

function runMutationTasks() {
  passDepth++;
  try {
    setPhase('mutate');
    const current = pendingMutationTasks;
    pendingMutationTasks = [];
    current.forEach(safeExec);
  } finally {
    passDepth--;
  }
}

function runForcedReflowTasks(): NoneToVoidFunction[] {
  passDepth++;
  try {
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
  } finally {
    passDepth--;
  }
}

function runForcedReflowMutations(mutations: NoneToVoidFunction[]) {
  passDepth++;
  try {
    setPhase('mutate');
    mutations.forEach(safeExec);
    setPhase('measure');
  } finally {
    passDepth--;
  }
}

/** @internal True inside a phase segment of a frame pass (see passDepth). */
export function isInFramePass() {
  return passDepth > 0;
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
 * Run a whole frame pass synchronously, with the real phase sequence (measure → mutate →
 * forced-reflow measure → forced-reflow mutate). Production contract (spec §3.1): allowed from
 * anywhere OUTSIDE a frame pass — an event handler, a store action, a tickEnd effect — for the
 * cases that need the DOM committed before the current task ends (an iOS swipe-back gesture, the
 * callback of a View Transition). Inside a pass (a frame effect's compute or apply, a
 * requestMeasure/requestMutation/requestForcedReflow task, a forceMeasure callback) it throws: the
 * phases would interleave. Does not bypass heavy-animation gating of the core's run queues. The
 * already-throttled rAF (if any) later fires with empty queues — harmless.
 */
export function flushSync() {
  if (passDepth > 0) {
    throw new Error(
      '[frameact] flushSync() is not reentrant: it was called inside a frame pass (a frame effect, a requestMeasure/requestMutation/requestForcedReflow task or a forceMeasure callback). Write the signal and let the frame apply it, or call flushSync() from the event handler or action that started this.',
    );
  }
  try {
    runMeasureTasks();
    runMutationTasks();
    runForcedReflowMutations(runForcedReflowTasks());
  } finally {
    setPhase('measure');
  }
}
