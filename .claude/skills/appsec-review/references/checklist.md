# appsec-review checklist

Grep patterns and attack scenarios per area. Run greps from the repo root against `src/` (and `test/` only to
confirm test-only code does not ship).

## DOM sinks / XSS (mostly `src/dom/*`)
```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc|createContextualFragment|DOMParser" src
grep -rnE "setAttribute(NS)?\(|\.href\s*=|\.src\s*=|style\.cssText|setProperty\(" src
grep -rnE "new Function|eval\(|setTimeout\(\s*['\"\`]" src
```
- Scenario: a username `"><img src=x onerror=alert(1)>` or a message rendered through a path that builds HTML.
- Scenario: a link preview with `href="javascript:…"`, `data:text/html,…`, or `xlink:href` on SVG.
- Scenario: a bot payload object spread onto an element (`<a {...payload}>`) sets `onclick`, `innerHTML`, `srcdoc`.
- `template(html)` must only ever receive compile-time constants from the compiler, never runtime strings.
- Event props must accept functions only; reject strings (`onclick="…"`).

## Prototype pollution / unsafe keys
```bash
grep -rnE "\[[a-zA-Z_]+\]\s*=|Object\.assign|\.\.\.[a-zA-Z_]+\b" src
```
- Keys from content (`message.id`, entity types, reaction emojis) used to index plain objects; `__proto__`,
  `constructor`, `prototype`. Prefer `Map`, `Object.create(null)`, or key validation.
- Context records built with spread are fine when keys are Symbols created by the framework.

## DoS by untrusted data
- Lists: 100 000 items, all-duplicate keys, keys of the synthetic-fallback form (`__index#N`) — time and memory.
- Effect cascades: can message content cause an effect to re-dirty itself or ping-pong indefinitely? Check the
  per-drain loop guard, the self-dirty guard (macrotask rescheduling), `flushSync` round caps — all must be
  bounded in production, not only in DEV.
- Regexes on user text (`grep -rn "new RegExp\|/.*/[gimsuy]*\.test\|\.match(" src`) — catastrophic backtracking.
- Timers: `setTimeout` loops or `requestIdleCallback` chains that never stop.

## Errors as a boundary
- Throwing user callbacks in: effect compute/apply, cleanups, once-callbacks, heavy-animation listeners,
  `onTickEnd`/`onIdle`/rAF callbacks, store action handlers. After each, does rendering continue?
- Errors logged with user content inside the message string (privacy); prefer logging the error object and a
  framework-generated label.
- Unhandled rejections from internal promise chains.

## Global / prototype patching
```bash
grep -rnE "prototype\.|Object\.defineProperty\(|globalThis\.|window\.[a-zA-Z]+\s*=|delete \(globalThis" src test
```
- Anything at import time in `src/` is suspicious; dev tooling (stricterdom) must be opt-in (`enableStrict()`).

## DEV vs production
- `process.env.NODE_ENV` must stay literal (bundler replacement); without replacement in a browser it throws.
- DEV-only handles (`signal.node`, `currentEffect`, diagnostic names) must be inside `if (DEV)`.

## Supply chain
```bash
pnpm audit --json | head -c 20000
grep -nE '"(dependencies|devDependencies|peerDependencies)"' -A 15 package.json
grep -nE "requiresBuild|hasInstallScript" pnpm-lock.yaml | head
```
- Runtime `dependencies` should be empty or minimal for a framework core.
- Vendored code (`src/core/*` from maverick, `src/scheduler/*` from teact): header present, licence listed in
  `THIRD_PARTY_LICENSES.md`, diff against upstream has no unexpected code.
- Compiler plugin (`@solidjs/babel-plugin`, plan 2) pinned; review what it injects.
