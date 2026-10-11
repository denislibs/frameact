/** Drain the microtask queue a few rounds (fasterdom chains 4 promise hops per frame). */
export async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
