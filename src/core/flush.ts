import { flushTickEnd } from '../scheduler/schedulers';
import { flushSync as flushFrame } from '../scheduler/fasterdom';

/** Run pending tickEnd effects, then a full synchronous frame pass. Tests and imperative glue only. */
export function flushSync() {
  flushTickEnd();
  flushFrame();
  flushTickEnd(); // writes made in the frame may have queued more tickEnd work
}
