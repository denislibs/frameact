# AGENTS.md

Guide for AI agents (and humans) contributing to **frameact**. Claude Code reads it through `CLAUDE.md`; Codex, Cursor,
Copilot and others read this file directly. Writing an *app* with frameact instead? See [`llms.txt`](llms.txt) and
[`docs/llms-full.md`](docs/llms-full.md).

## What this is

frameact is a SolidJS-style fine-grained signals UI framework (no virtual DOM, components run once, only bindings
update) with teact-style frame discipline: all reactive work and DOM writes go into one `requestAnimationFrame` pass
split into phases. The target consumer is a Telegram Web A–class messenger. MIT, early development, `private` package
(not on npm). The design is the source of truth: `docs/superpowers/specs/2026-10-11-frameact-design.md` (Russian).

## Repo map

| Path | What lives there |
|---|---|
| `src/core/` | signals, memos, two-phase effects, frame queues, owner tree, context, `mapArray`; adapted maverick-js/signals |
| `src/scheduler/` | fasterdom phases (`requestMeasure`/`requestMutation`/…), `tickEnd`/idle schedulers, heavy-animation scopes |
| `src/dom/` | runtime the Solid 2.0 JSX compiler targets (`frameact/dom`): `template`, `insert`, `spread`, `For`/`ManualFor`/`Show`/`Switch`/`Dynamic`/`Portal`, controlled inputs, classes/styles/attributes, event delegation, `natives.ts` |
| `src/store/` | `frameact/store`: signal-tree store (model B), `reconcile`, actions, heavy-animation parking gate |
| `src/stricterdom/` | `frameact/stricterdom`: DEV phase checks with effect attribution, run profiler |
| `src/kit/` | `frameact/kit`: `Transition`, `ShowTransition`, `InfiniteScroll`, `createScrollAnchor` |
| `src/vite/` | `frameact/vite`: Vite plugin = Solid babel plugin pinned to `moduleName: "frameact/dom"` + DEV source lints |
| `src/jsx/`, `src/jsx-runtime.ts` | JSX types only (`jsx: "preserve"`, the compiler lowers JSX) |
| `src/env.ts` | the `DEV` flag |
| `test/` | vitest + jsdom, mirrors `src/` (`test/core`, `test/dom`, `test/store`, …); `test/helpers/`; `test/chrome/` is the real-Chrome lane |
| `bench/` | `reactivity/` (js-reactivity-benchmark adapter), `store/` (micro-benches), `dom/` (vitest benches) |
| `docs/` | `superpowers/specs` (design), `superpowers/plans` (per-feature plans), `guides/` (porting guide), `assets/` (README media; do not touch) |
| `.claude/skills/` | `perf-review`, `appsec-review` (see "Review skills") |

Public entry points are listed in `package.json` `exports`: `frameact`, `frameact/dom`, `frameact/scheduler`,
`frameact/store`, `frameact/stricterdom`, `frameact/vite`, `frameact/jsx-runtime`, `frameact/kit`. A new
entry needs the `exports` line, a `paths` entry in `tsconfig.json` and an alias in `vitest.config.ts`.

## Commands

```bash
pnpm install --frozen-lockfile   # Node >= 22.12, pnpm 10 (no packageManager field; lockfileVersion 9.0)
pnpm check                       # = pnpm lint && pnpm typecheck && pnpm test   (what CI runs; must be green)
pnpm lint                        # oxlint src test — zero errors AND zero warnings (the exit code is 0 with warnings: read the output)
pnpm typecheck                   # tsc --noEmit, TypeScript 7 (native)
pnpm test                        # vitest run (jsdom)
pnpm exec vitest run test/store/store.test.ts            # one file
pnpm exec vitest run test/dom/for.test.ts -t "manual"    # one test by name
pnpm test:watch
pnpm test:chrome                 # stricterdom in headless Chrome (build test/chrome, vite preview on 127.0.0.1:4178)
                                 # Chrome: CHROME_BIN, else the macOS app, else google-chrome/chromium on PATH; CHROME_TIMEOUT_MS (60 s)
node bench/reactivity/run.mjs --check    # adapter correctness for js-reactivity-benchmark (clones upstream, needs network)
pnpm bench:reactivity                    # full run (~10 min) -> bench/reactivity/results/
node bench/store/run.mjs [filter]        # store/core micro-benches, prod bundle, one process each
pnpm exec vitest run --config bench/dom/vitest.config.ts   # DOM benches (not part of pnpm test)
```

CI (`.github/workflows/ci.yml`) runs `pnpm check` on Node 22.12 and 24, plus `pnpm test:chrome` on Linux Chrome.
`bench-check.yml` runs the adapter check weekly. There is no publish job: exports point at `.ts` sources, so an npm
release first needs a build step.

## Architecture invariants (do not break)

1. **One rAF pass, phases in order**: `measure → mutate → forced-reflow measure → forced-reflow mutate`. N dirty effects
   cost one rAF and one task per phase. A signal written in a measure apply reaches mutation effects in the same frame;
   a measure effect dirtied from the mutate phase runs next frame (DEV warns). `flushSync()` commits synchronously: legal
   from event handlers, store actions and tickEnd effects, throws inside a frame pass.
2. **DOM discipline**: layout reads (`offsetHeight`, `getBoundingClientRect`, `scrollTop` read, `focus()`,
   `getComputedStyle`, …) only in the measure/forced-reflow phase; live-DOM writes only in the mutate phase. Detached
   nodes may be written anywhere (that is how the runtime builds DOM). stricterdom enforces this in DEV; new code must be
   clean under `enableStrict()` (the full-app tests assert 0 violations).
3. **Two-phase effects**: `createEffect(compute, apply, schedule?)` — `compute` is tracked and pure, `apply(value, prev)`
   is untracked and does the side effect (may return a cleanup). The schedule picks the phase (`tickEnd` default,
   `frameMeasure`, `frameMutation`, `frameForcedReflow`, `idle`). Mutation effects apply synchronously on creation; the
   first apply of every other effect is scheduled. `onCleanup` inside an apply is a DEV error: return the cleanup.
4. **Heavy-animation gating**: a blocking animation parks frame work per `HeavyAnimationScope` (global `rootScope` or a
   subtree) and releases it atomically in one frame, measure first. Store-caused frame effects park *by cause*: they wait
   only while store writes are the sole reason they are dirty; local signals, `live()` reads, `ungated()` writes,
   tickEnd logic and controlled inputs never wait. No computation may see two moments of the store.
5. **DEV-only code is dead in production.** Everything dev-only (attribution, warnings, profiler, stricterdom) sits
   behind `if (DEV)` from `src/env.ts`, whose definition keeps `process.env.NODE_ENV` literal and unguarded so bundlers
   fold it. Guard with `DEV`, never with a local copy of the check. Production tests re-import the graph with
   `NODE_ENV=production` (`test/stricterdom/production.test.ts`, `test/dom/component.prod.test.ts`); extend them when you
   add DEV identifiers. Production behaviour must match DEV apart from diagnostics.
6. **DOM clobbering**: `<form>` children with `id`/`name` such as `parentNode`, `remove` or `appendChild` shadow the
   form's own members. The runtime reads structure and calls DOM methods through the prototype natives cached in
   `src/dom/natives.ts` (`getNatives()`, `.call(node, …)`), never as `node.parentNode` on a node that may be content-derived.
   Tests: `test/dom/clobbering*.test.ts`, `test/helpers/clobber.ts`.
7. **Store hardening**: the store owns and mutates its state in place. Key `__proto__` is dropped (DEV logs), builtin
   prototypes and frozen objects are values, never wrapped; class instances, Dates, Maps are values; `state` is read-only
   (writes throw); `produce` drafts are valid only inside their callback. Tests: `test/store/hardening.test.ts`,
   `security.test.ts`.
8. **Security policy in the DOM runtime**: attribute writes (`setAttribute`, spread, compiled attributes) refuse
   `javascript:`/`vbscript:` URLs, non-media `data:` URLs, string `on*` handlers and `srcdoc=`; refusals are silent in
   prod and `console.error` in DEV. `<Dynamic component="tag">` validates tag names and creates `script` inert. Explicit
   sinks (`innerHTML=`, `prop:*`, spread *keys*) are the author's responsibility and documented as such in the README. Never
   add a path from content-derived data to a sink; never export the policy tables (`Properties`, `Aliases`, …) from
   `frameact/dom`. `message`/`path` strings that embed content (ids, classes, store keys) are JSON-quoted and cut to 64 chars.
9. **Components run once; props are getters.** Never destructure props in framework code, tests or examples
   (`function X({ a })` reads once). Controlled inputs are `use:value` / `use:checked`, not `value=`.
10. **Isolation of failures**: a throwing effect, memo, store action or handler is reported (`onError` handlers, else
    `console.error`) and must not break the graph, the queue or the frame; DEV hooks are contained so they cannot leave
    `currentEffect` swapped.

## Coding conventions

- TypeScript 7 (`tsc`, strict), ESM, extension-less relative imports inside `src` (`.ts` suffix only in config files).
  oxlint (`.oxlintrc.json`: correctness=error, suspicious=warn, unicorn): **zero warnings**. `no-underscore-dangle` is off
  in `src/core/**`, `test/core/**`, `test/effects/**` only, so `src/scheduler` and `src/dom` do not read `node._*` fields.
  Prefix unused params with `_`.
- **TDD**: write the failing test first (watch it fail for the right reason), then the code; fix a bug with a regression
  test. Tests are vitest + jsdom with `globals: true`; `test/setup.ts` removes `requestIdleCallback` (idle falls back to a
  microtask). Drive frames with the helpers in `test/helpers/` (`raf.ts`, `frame.ts`, `micro.ts`) and `flushSync()`. Never
  `expect` inside a scheduler callback or an effect apply: log into an array, assert after the flush. Restore console spies.
- Match the surrounding comment density: this codebase comments the *why* (invariants, trade-offs, measured costs, audit
  references like "R1"), at file/function level, not line-by-line narration. Comments in English.
- Hot paths (core, store reads, `insert`, `reconcile`): no per-call closures or allocations that a measurement did not
  justify; keep hidden classes stable. Prove with a bench (see Performance).
- Keep modules small and single-purpose; new public API goes through the entry `index.ts` with `type` exports.
- **File headers for adapted code**: `// Adapted from <repo> (<license>, © <holder>) — <url> [path]` as the first line,
  followed by a short "frameact:" note on what changed (see `src/stricterdom/stricterdom.ts`).

## Licensing (read before porting anything)

frameact is MIT. Third-party code is allowed only when its license permits it and it is attributed:

- Adapted MIT/ISC code keeps `// Adapted from <repo> (<license>, © <holder>)` in the file **and** gets an entry in
  `THIRD_PARTY_LICENSES.md` (file list under the project heading). Current sources: maverick-js/signals,
  Ajaxy/teact, ryansolid/dom-expressions, solidjs/solid, udomdiff (ISC).
- **Never copy or paraphrase telegram-tt** (`Ajaxy/telegram-tt`, GPL-3.0), **including its in-tree copy of teact**
  (`src/lib/teact` there). Only the separate **Ajaxy/teact** repository is MIT. If you are unsure which repo a snippet
  came from, do not use it.
- telegram-tt *behaviour* may be re-implemented **clean-room**: from the observable behaviour, public interfaces and our own
  tests, without having the GPL source open in front of you. The kit modules (`animationEnd`, `transition`,
  `infiniteScroll`, `showTransition`, `debounce`) and the stricterdom ignore/`details[open]` behaviours were done this way;
  their headers say "in the spirit of" / "re-implemented from behaviour". Say so in the header of any new such module.
- Vendored test fixtures (`test/dom/fixtures`) carry a `SOURCE` file instead of per-file headers; do not edit them.
- Do not add dependencies without a reason recorded in the PR; check the license of anything new.

## Docs conventions

- `README.md` (English) is mirrored by `README.ru.md` and `README.zh-CN.md`: any change to the English README (API facts,
  status, roadmap, dev commands) is made in all three in the same commit. Keep the language switcher line intact.
- The spec (`docs/superpowers/specs/2026-10-11-frameact-design.md`, Russian) is updated when behaviour or a decision
  changes; plans live in `docs/superpowers/plans/<date>-<topic>.md` and are written before large work. Do not
  rewrite history in a spec: add to its "history of decisions" sections.
- User-facing API documentation for app authors is `llms.txt` + `docs/llms-full.md`; keep every name and signature in
  them true to `src/` (grep before writing). Update them when a public API changes.
- Do not modify `docs/assets/*` (generated media) unless that is the task.

## Git conventions

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `perf/<topic>`, `docs/<topic>`, `chore/<topic>`. Work in a git
  worktree under `.worktrees/<name>` (`git worktree add .worktrees/<name> -b <branch> origin/main`); never work in `/tmp`.
- Conventional commits with a scope, as in `git log`: `feat(store): …`, `fix(stricterdom): …`, `perf(core): …`,
  `test(dom): …`, `docs(spec): …`, `ci: …`. Small logical commits; the message says *why*. Stage explicit paths, not `git add -A`.
- PRs go to `main` (merge commits are used). `pnpm check` must be green; run `pnpm test:chrome` when you touch stricterdom,
  the phase machinery or `src/dom` writes. Describe what you could not verify.
- Do not push, force-push or merge unless asked.

## Performance discipline

- A perf change needs a measurement before and after. Layers: js-reactivity-benchmark for the graph
  (`bench/reactivity`, compare ratios to alien-signals *within one run*, never against upstream's published numbers),
  `bench/store` for store/core micro-benches, `bench/dom` for `reconcile`/spread/manual order.
- Report numbers with the machine and the **load average** (`uptime`; the benches are single-threaded and noisy under
  load — repeat a run that looks off, family geomeans move ±0.05–0.1 between idle runs). Say what is noise.
- Record negative results in the plan so nobody re-tries them blindly (see `docs/superpowers/plans/2026-10-15-core-perf.md`
  after PR #12). `bench/` is neither linted nor type-checked; keep it runnable on a baseline worktree.
- Semantics are not a perf lever: owners, cleanup order, two-phase effects, the `tickEnd` loop guard, store parking and
  error isolation stay as they are.

## Review skills

Project skills in `.claude/skills/` (Claude Code loads them by description; other tools can read the `SKILL.md` and
`references/checklist.md` as checklists):

- `perf-review` — performance review from a Telegram Web A engineer's view: hot paths, allocations, memory over long
  sessions, frame budget. Use before merging changes to core, scheduler, effects, `mapArray`, DOM runtime or store.
- `appsec-review` — XSS sinks, prototype pollution, DoS by untrusted data, error handling that can freeze the UI,
  global patching, DEV vs prod leaks, supply chain. Use before merging changes to the DOM runtime, attribute setters,
  events, the store or dependencies.

Both skills answer in Russian by default in this project; the code, commits and docs stay English (the spec and bench
READMEs are the Russian exceptions).
