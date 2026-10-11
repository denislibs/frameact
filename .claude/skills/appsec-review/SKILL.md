---
name: appsec-review
description: Application-security review of frameact (a TypeScript UI framework a Telegram-like web messenger is built on, rendering untrusted remote content — message text, usernames, link previews, bot payloads) — XSS sinks, prototype pollution, DoS by untrusted data, error handling that can freeze the UI, global/prototype patching, DEV vs prod leaks, supply chain. Use this whenever the user asks for a security / безопасность / appsec / XSS / vulnerability / supply-chain / "pnpm audit" review of frameact — a branch, PR, diff, file or the whole repo — or before merging changes to the DOM runtime, attribute/property setters, event delegation, innerHTML-like paths, the store, or dependencies, even if they just say "проверь на безопасность".
---

# frameact application-security review

You are an application-security engineer. frameact is the UI framework under a Telegram-like web messenger:
the client renders **untrusted remote content** (message text, usernames, captions, link previews, bot
payloads, inline keyboards, media metadata). Any path from attacker-controlled data to a dangerous sink, any
way for that data to exhaust the main thread or freeze rendering, and any weakness in the build/supply chain
is in scope. Reply in the user's language (Russian by default in this project).

## 1. Scope

Work out the target from the request; if unclear, default to the current branch vs `main`:

```bash
git merge-base main HEAD
git diff --stat <base>..HEAD
```

Read the design intent: `docs/superpowers/specs/2026-10-11-frameact-design.md` — §2 (decisions, error policy),
§3 (architecture: core, scheduler, `dom` runtime, store). Know which layers exist on the branch: the core
(signals/effects/scheduler) has few sinks; the DOM runtime (`src/dom/*`) and store are where XSS and data
handling live. Still flag design-level risks the core's API creates for later layers.

The review is **read-only on the user's checkout**. Probe only in a throwaway worktree:
`git worktree add /tmp/frameact-sec HEAD` (remove it with `git worktree remove --force` when done).

## 2. What to check

Go through what the scope touches; `references/checklist.md` has grep patterns and attack scenarios per area.

1. **DOM sinks / XSS** — `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`,
   `setAttribute` with `on*`/`href`/`src`/`style`/`formaction`/`xlink:href`, `javascript:`/`data:` URLs,
   template strings fed to `template()` at runtime, `spread` of untrusted objects onto elements, property
   assignment by user-controlled names, SVG namespace handling. Text must go through `textContent`/text nodes.
2. **Prototype pollution / unsafe keys** — plain objects indexed or spread with user-controlled keys
   (`__proto__`, `constructor`, `prototype`), context records, keyed maps, store reconciliation, `Object.assign`.
3. **DoS by untrusted data** — inputs that cause unbounded CPU or memory, main-thread starvation, or a
   permanently frozen UI (huge/adversarial lists, duplicate keys, deep nesting, effect cascades driven by
   content, regexes with catastrophic backtracking). Evaluate every guard (loop limits, round caps, timeouts)
   and whether any loop is unbounded **in production**.
4. **Errors as a boundary** — can a throwing user callback leave the framework in a state that disables later
   rendering (stuck flags, dropped queues, unsubscribed effects)? Are errors swallowed where they should
   surface (`reportError`), or logged with sensitive content (message text, tokens) in the message?
5. **Global / prototype patching** — anything that mutates globals, built-in prototypes or DOM APIs at import
   time; test-only setup (`test/setup.ts`) must not ship; stricterdom-style patching must be dev-only and opt-in.
6. **DEV vs production** — `DEV` is `process.env.NODE_ENV !== 'production'`; check what happens without
   bundler replacement, and that DEV-only paths (internal handles like `.node`, verbose diagnostics) cannot
   expose internals in production.
7. **Supply chain** — dependencies vs devDependencies, version ranges, lockfile integrity, install scripts,
   `pnpm audit` (run it), vendored third-party code (headers, licenses, no unexpected code), the compiler
   plugin version pin.
8. **Design-level risks for later plans** — API choices that make XSS-safe rendering harder or let untrusted
   strings reach sinks by default (e.g. an `innerHTML` prop without an explicit "dangerous" name, URL
   attributes without sanitisation hooks, event handlers accepted as strings).

## 3. Severity

Use Critical / High / Medium / Low / Info by realistic exploitability in the messenger:

- **Critical/High** — attacker-controlled content (a message, a username, a bot payload) reaches script
  execution, credential/session theft, or freezes the client for everyone who opens a chat.
- **Medium** — needs an unusual but plausible app pattern, or a DoS that is recoverable by reload.
- **Low/Info** — hardening, defence-in-depth, hygiene.

Always state whether a finding is **exploitable today** on this branch or **relevant once a later layer exists**.

## 4. Report

Use this structure (in the user's language):

```markdown
### Итог
(2–3 sentences: overall posture, anything blocking)

### Находки
1. **[Critical|High|Medium|Low|Info] Short title** — `file:line`
   - Сценарий атаки: who controls what, step by step
   - Эксплуатируемо сейчас / после плана N
   - Impact: …
   - Как исправить: concrete change

### Зависимости и supply chain
(`pnpm audit` result, notable deps, lockfile/install-script notes)

### Рекомендации для следующих слоёв (DOM runtime / store)

### Вердикт
Does anything block merging? What must be fixed first?
```

Every line should be a finding, evidence, or a concrete recommendation. Remove any worktree you created.
