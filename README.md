# frameact

Fine-grained signals UI framework with teact's rendering discipline: one rAF pass per frame,
measure/mutate phases, heavy-animation gating, stricterdom. Design: `docs/superpowers/specs/`.

Status: plan 1 (core) — signals, effects, scheduler. No DOM runtime yet (plan 2).

```ts
import { createSignal, createMutationEffect, createMeasureEffect, flushSync } from 'frameact';
```
