import type { installFakeRaf } from './raf';
import { flushMicrotasks } from './micro';

/** Fire one animation frame and let fasterdom's phase microtasks settle. */
export async function frame(raf: ReturnType<typeof installFakeRaf>) {
  raf.frame();
  await flushMicrotasks();
}
