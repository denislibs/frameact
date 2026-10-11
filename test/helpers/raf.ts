type Cb = (now: number) => void;

export function installFakeRaf() {
  const original = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  let queue: { id: number; cb: Cb }[] = [];
  let nextId = 1;
  let now = 0;

  globalThis.requestAnimationFrame = (cb: Cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    queue = queue.filter((q) => q.id !== id);
  };

  return {
    /** Fire every callback queued so far (callbacks queued during the frame wait for the next frame). */
    frame(step = 16) {
      now += step;
      const current = queue;
      queue = [];
      for (const { cb } of current) cb(now);
    },
    pending: () => queue.length,
    uninstall() {
      globalThis.requestAnimationFrame = original.raf;
      globalThis.cancelAnimationFrame = original.caf;
    },
  };
}
