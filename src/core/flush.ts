import { flushTickEnd, hasPendingTickEnd } from '../scheduler/schedulers';
import { flushSync as flushFrame, hasPendingFrameTasks } from '../scheduler/fasterdom';

const MAX_ROUNDS = 100;

/**
 * Run pending tickEnd effects and full synchronous frame passes until neither has work left (a
 * tickEnd apply can dirty frame work and vice versa). Tests and imperative glue only.
 */
export function flushSync() {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    flushTickEnd();
    flushFrame();
    if (!hasPendingTickEnd() && !hasPendingFrameTasks()) return;
  }
  console.error(`[frameact] flushSync() did not settle after ${MAX_ROUNDS} rounds — likely an effect loop. Remaining work stays scheduled.`);
}
