// Tests assume no requestIdleCallback: onIdle() falls back to onTickEnd (a microtask).
delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
