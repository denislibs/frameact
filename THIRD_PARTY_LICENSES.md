# Third-party licenses

frameact vendors and adapts code from the following projects (MIT unless noted; udomdiff is ISC).
Each adapted file carries an `Adapted from …` header. The license texts follow the list.

## maverick-js/signals — MIT License, Copyright (c) 2022 Rahim Alwer
`src/core/core.ts`, `src/core/signals.ts`, `src/core/map.ts`, `src/core/selector.ts`,
`src/core/types.ts`, `src/core/symbols.ts`

## teact (Ajaxy/teact) — MIT License, Copyright (c) 2022 Alexander Zinchuk
`src/scheduler/schedulers.ts`, `src/scheduler/fasterdom.ts`, `src/scheduler/heavyAnimation.ts`,
`src/dom/classes.ts`, `src/dom/styles.ts`, `src/dom/directives.ts`, `src/dom/list.ts`

## dom-expressions (ryansolid/dom-expressions) — MIT License, Copyright (c) 2018-2019 Ryan Carniato
`src/dom/constants.ts`, `src/dom/template.ts`, `src/dom/insert.ts`, `src/dom/events.ts`,
`src/dom/attributes.ts`, `src/dom/props.ts`, `src/jsx/jsx.d.ts`

## solidjs/solid (packages/web, packages/babel-plugin) — MIT License, Copyright (c) 2016-2025 Ryan Carniato
`src/dom/template.ts`, `src/dom/reconcile.ts`, `src/dom/insert.ts`, `src/dom/attributes.ts`,
`src/dom/classes.ts`, `src/dom/styles.ts`, `src/dom/flow.ts`, `src/dom/props.ts` (mergeProps, splitProps), `src/dom/component.ts` (children),
`test/dom/fixtures/**` (compiler fixtures, `__dom_fixtures__`)

## udomdiff (WebReflection/udomdiff) — ISC License, Copyright (c) 2020 Andrea Giammarchi
`src/dom/reconcile.ts` (via solidjs/solid `packages/web/src/reconcile.ts`)

---

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

ISC License (udomdiff)

Copyright (c) 2020, Andrea Giammarchi, @WebReflection

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
