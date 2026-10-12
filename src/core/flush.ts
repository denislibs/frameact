import { flushTickEnd, hasPendingTickEnd } from '../scheduler/schedulers';
import { flushSync as flushFrame, hasPendingFrameTasks, isInFramePass } from '../scheduler/fasterdom';

const MAX_ROUNDS = 100;

/**
 * Run pending tickEnd effects and full synchronous frame passes until neither has work left (a
 * tickEnd apply can dirty frame work and vice versa). Allowed in production from outside a frame
 * pass (an event handler, a store action, a tickEnd effect) when the DOM must be committed before
 * the current task ends — an iOS swipe-back gesture, a View Transition callback; inside a frame pass
 * it throws (scheduler/fasterdom.ts). Tests use it as their frame.
 */
export function flushSync() {
  if (isInFramePass()) flushFrame(); // throws the "not reentrant" error before any tickEnd effect runs inside the pass
  for (let round = 0; round < MAX_ROUNDS; round++) {
    flushTickEnd();
    flushFrame();
    if (!hasPendingTickEnd() && !hasPendingFrameTasks()) return;
  }
  console.error(`[frameact] flushSync() did not settle after ${MAX_ROUNDS} rounds — likely an effect loop. Remaining work stays scheduled.`);
}
