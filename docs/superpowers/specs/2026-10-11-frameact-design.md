# frameact — дизайн v1

Дата: 2026-10-11. Статус: черновик на ревью.

## 1. Что это и зачем

**frameact** — fine-grained реактивный UI-фреймворк на сигналах, который реализует
принципы рендеринга teact (Telegram Web A):

- **один проход на кадр** — вся работа графа и все записи в DOM планируются в один
  `requestAnimationFrame`;
- **явные фазы** `measure → mutate → forced-reflow measure → forced-reflow mutate` —
  чтение layout никогда не перемежается с записью в DOM;
- **гейтинг тяжёлых анимаций** — во время blocking-анимации проход кадра откладывается
  целиком, пока анимация не закончится;
- **stricterdom** — dev-режим, который ловит нарушения фаз на уровне DOM API.

При этом вместо VDOM и ре-рендера компонентов — реактивный граф и точечные обновления
DOM (модель SolidJS). Компонент выполняется один раз; обновляются только биндинги.

Целевой потребитель — клиент мессенджера масштаба Telegram Web A: длинные списки,
высокочастотные обновления стора, много CSS/JS-анимаций, iOS Safari.

### Чем это отличается от существующего

| | teact | Solid 1.x / 2.0 | frameact |
|---|---|---|---|
| Обновление | VDOM-дифф, ре-рендер компонента | fine-grained | fine-grained |
| Когда флашится | rAF, один проход | микротаск | rAF, один проход |
| Фазы measure/mutate | да | нет | да |
| Гейтинг анимаций | да | нет | да |
| Проверка нарушений фаз | stricterdom | нет | stricterdom |

## 2. Принятые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Ядро сигналов | Форк `maverick-js/signals` v6 (MIT, ~1k строк), вендорится в `src/core` | Код прост и закончен; весь планировщик там — одна функция, которую мы заменяем. Полное владение. `@solidjs/signals` 2.0 — 18k строк RC с транзакциями/lanes, флаш в микротаске захардкожен |
| Компилятор | `@solidjs/babel-plugin` 2.0 с `moduleName: "frameact/dom"` | Эмитит двухфазные эффекты `_$effect(compute, apply)` — чистое вычисление и DOM-запись уже разделены, это ровно та граница, по которой проходят фазы. Писать свой компилятор — отдельный проект |
| DOM-рантайм | Порт `dom-expressions` 1.x client (MIT), адаптированный к API, которое импортирует компилятор 2.0 | Стабилен годами, ~1k строк, не завязан на RC-семантику 2.0 |
| Flow-компоненты | Свои `For`/`Show`/`Switch`/`Match`/`Dynamic`/`Portal` поверх `mapArray` | ~200–300 строк; `solid-js` тянет `@solidjs/signals` |
| API для авторов | Чистый Solid-стиль: компонент выполняется один раз, пропсы-геттеры, `createSignal`/`createMemo` | Hooks-прослойка поверх fine-grained даёт худшее из обоих миров. Код из telegram-tt не переносится 1:1 — это осознанно |
| Семантика записи | `set()` обновляет значение сразу, чтение сразу видит новое; эффекты ждут кадра | Как Solid 1.x. Проще teact'овского `nextValue`, минусов для целевого приложения не найдено |
| События | Соглашения Solid: `onClick`, `onInput`, делегирование через document; `on:name` для нативных | Компилятор эмитит `addEvent(el, name, handler, delegate)` под эту модель |
| Refs | `ref={el => …}` / `ref={variable}` | Solid-стиль |
| Ошибки | Ошибка в compute/apply логируется (или уходит в ближайший `onError`-scope) и **не роняет кадр** | Teact'овская устойчивость. Solid 2.0 в этой ситуации останавливает реактивность целиком — для мессенджера неприемлемо |
| Структура | Один пакет с subpath-экспортами | Монорепа не нужна до второго потребителя |

## 3. Архитектура

```
frameact                 — сигналы, эффекты с фазами, flow-примитивы, heavyAnimation
frameact/scheduler       — fasterdom: rAF, фазы, requestMeasure/Mutation/ForcedReflow
frameact/dom             — рантайм для компилятора (moduleName), render, For/Show/…
frameact/stricterdom     — dev-only контроль фаз
frameact/vite            — Vite-плагин (обёртка @solidjs/babel-plugin)
```

Зависимости между слоями: `dom → core → scheduler`; `stricterdom ← scheduler`
(планировщик вызывает `setPhase`). `core` не знает про DOM.

### 3.1 `scheduler` — fasterdom

Порт `teact/src/lib/fasterdom/fasterdom.ts` и `util/schedulers.ts` без изменений
семантики:

- `fastRaf(cb, withTimeoutFallback)` — объединяет колбэки в один rAF; фолбэк 35 мс
  через `setTimeout` для фоновых вкладок и iOS.
- Один проход кадра:
  ```
  rAF:
    setPhase('measure');  measureTasks()
    microtask: setPhase('mutate');  mutationTasks()
    microtask: setPhase('measure'); forcedReflowTasks() → собирают mutation-колбэки
    microtask: setPhase('mutate');  forcedReflowMutationTasks()
    setPhase('measure')
  ```
- API: `requestMeasure(cb)`, `requestMutation(cb)`, `requestNextMutation(cb)`,
  `requestForcedReflow(cb)`, `onTickEnd`, `onIdle`, `throttleWith`.

Фазы — это очереди; задачи, добавленные во время выполнения очереди, попадают в
следующий кадр (как в teact). Исключение — forced-reflow очереди, которые дочитывают
задачи, добавленные в процессе.

### 3.2 `core` — сигналы

Файлы из maverick: `core.ts`, `signals.ts`, `map.ts`, `selector.ts`, `types.ts`,
`symbols.ts`. Алгоритм графа (Reactively: `CLEAN/CHECK/DIRTY`, `updateCheck`,
`runTop` по owner-цепочке) **не меняется**. Меняется только то, что происходит,
когда эффект помечается грязным.

#### Эффекты: две половины, фаза = планировщик

Принцип тот же, что в teact (`throttleWith(requestMeasure, fn)`): эффект не
знает про фазы, он знает, **через какую функцию его планировать**. Фазовые
гарантии даёт fasterdom.

```ts
type Schedule = (run: () => void) => void;

// базовый примитив
createEffect(compute, apply, schedule: Schedule = onTickEnd)
// compute: (prev) => T                      — трекается, чистый, без DOM
// apply:   (value, prev) => void | cleanup  — без трекинга; здесь побочные эффекты

// фасады — публичный API для авторов
createEffect(compute, apply)          // onTickEnd (микротаск): логика без DOM — сеть, стор
createMeasureEffect(compute, apply)   // requestMeasure: чтение layout
createMutationEffect(compute, apply)  // requestMutation: запись в живой DOM
createIdleEffect(compute, apply)      // onFullyIdle: фоновая работа, когда нет анимаций
createRenderEffect                    // alias createMutationEffect — имя, которое ждёт компилятор
```

Жизненный цикл:

- Эффект становится грязным (`notify` из maverick, только из состояния `CLEAN` —
  это и есть дедуп) → ядро вызывает `schedule(run)`.
- `run`: если узел задиспозен — выход; иначе `runTop` (грязные эффекты-предки
  раньше), пересчёт `compute` как обычной computation графа; если результат
  изменился (`!==`) — cleanup предыдущего `apply`, затем `apply(value, prev)`.
- `apply` может вернуть cleanup; он вызывается перед следующим `apply` и при dispose.
- **Первый запуск** `apply` — синхронно при создании (как Solid 1.x). Нужно,
  чтобы создание поддерева было атомарным: DOM-узлы в этот момент detached,
  stricterdom такие записи не считает нарушением (см. 3.4).
- Однофазной формы `effect(fn)` нет. Своя сравнивалка результата — через
  `createMemo(fn, { equals })` в compute-половине; `options.equals` у эффектов нет.

Что из этого следует — без отдельного «прохода кадра» в ядре:

| Ситуация | Что происходит |
|---|---|
| N эффектов загрязнены одной записью | N задач в **одном** rAF (fasterdom батчит), порядок — порядок уведомления |
| mutate-эффект загрязнён из measure-applier | `requestMutation(run)` → mutate-фаза **этого же** кадра |
| measure-эффект загрязнён из mutate-applier | `requestMeasure(run)` → следующий кадр |
| mutate-эффект загрязнён из mutate-applier | следующий кадр (очередь уже забрана) |
| нужно measure после mutate в том же кадре | `createEffect(c, a, requestForcedReflow)` |
| родитель пересоздал поддерево | дети задиспозены до своих `run` → пропускаются |

Гейтинг heavy animation — внутри `run` для кадровых планировщиков
(`requestMeasure`/`requestMutation`/`requestForcedReflow`): если
`isBlockingAnimating()` — `once(run)` и выход. Сырые `requestMeasure`/`requestMutation`
для анимаций не гейтятся, как в teact. `onTickEnd`- и `onFullyIdle`-эффекты не
гейтятся (логика не должна ждать анимацию; idle и так её ждёт).

Отличие от teact: teact замораживает **всё** на blocking-анимации, включая
`setState`. У нас запись в сигнал проходит мгновенно (значение видно
синхронно, например в обработчике), а откладывается только кадровая работа.
Консистентные чтения без потери гейтинга.

#### Остальное API core

- `createSignal(value, { equals? })` → `[get, set]`; `createMemo(fn, { equals? })`;
  `createRoot(fn)`; `onCleanup(fn)` (= `onDispose`); `untrack`; `peek`; `getOwner`;
  `runWithOwner` (= `scoped`); `onError`.
- `createContext(default)` / `useContext(ctx)` поверх `setContext`/`getContext`.
- `createSelector` — из maverick как есть.
- `mapArray(list, mapFn, { keyed })`:
  - `keyed: true` (по ссылке) — `computedKeyedMap` из maverick;
  - `keyed: false` (по индексу) — `computedMap`;
  - `keyed: (item) => key` — **новое**: дифф по ключу, `mapFn(item: Accessor, index: Accessor)`.
    Обязательно для иммутабельных данных telegram-tt, где объект сообщения
    пересоздаётся при каждом изменении, а строка должна обновиться на месте.
- `flushSync()` — выполнить проход кадра синхронно (тесты, `render`).
- `batch` не нужен: эффекты и так ждут кадра.

#### heavyAnimation

Порт `teact/src/teact/heavyAnimation.ts`: счётчики, `beginHeavyAnimation(duration =
1000, isBlocking = false)` → `onEnd`, сигналы `getIsHeavyAnimating` /
`getIsBlockingAnimating` (с `.once`), `onFullyIdle`, `throttleWithFullyIdle`.
Плюс `onHeavyAnimation(onStart, onEnd)` как замена хука `useHeavyAnimation`.

Blocking гейтит проход кадра (см. выше). Non-blocking ядро **не гейтит** — это
ответственность слоя стора в приложении (как TeactN: отложить применение
глобального стейта до `getIsHeavyAnimating.once`).

### 3.3 `dom` — рантайм

Контракт задаёт компилятор: набор импортов из `moduleName`. Полный список
фиксируется acceptance-тестом (см. 5), ожидаемый состав: `template`, `insert`,
`effect`, `memo`, `createComponent`, `spread`, `assign`, `mergeProps`,
`setAttribute`, `setAttributeNS`, `setProperty`, `className`, `style`,
`setStyleProperty`, `addEvent`, `delegateEvents`, `ref`/`applyRef`, `use`,
`readShallow`, `Portal`, `Dynamic`, `For`, `Show`, `Switch`, `Match`, `Repeat`.

База — `dom-expressions` 1.x `client.js`, с изменениями:

- `effect(compute, apply)` → `createRenderEffect` (фаза mutate).
- `insert(parent, accessor, marker)`: compute = `normalize(accessor())` (здесь
  создаются поддеревья — чистый JS над detached DOM), apply = `insertExpression`
  (вставка в живой DOM). Дифф массивов — `reconcileArrays` из dom-expressions.
- `className`: **дифф токенов** — `prev` vs `next`, только `classList.add/remove`
  изменившихся. Императивно добавленные классы переживают реактивные обновления
  без реестра extra-классов.
- `style`: объектная форма — per-property дифф (как в dom-expressions);
  строковая — `cssText`. Документируется: строковый `style` несовместим с
  `setExtraStyles`.
- `render(code, el)`: `createRoot` → создать поддерево → `flushSync()`.
  Монтирование синхронное, как `TeactDOM.render`.

Хелперы для императивных анимаций (API-совместимость с teact):
`addExtraClass`, `removeExtraClass`, `toggleExtraClass`, `setExtraStyles` —
тонкие обёртки над `classList` / `style.setProperty`. Stricterdom следит, что их
зовут в mutate-фазе.

#### Контролируемые инпуты

Для `INPUT`/`TEXTAREA`/`SELECT` с биндингом `value` или `checked`:

- applier `value` перед записью снимает `selectionStart/End`, после — восстанавливает;
  если каретка была в конце — оставляет в конце. Порт `setAttribute('value')` из teact.
- элемент помечается controlled; один делегированный `input`-listener после
  пользовательских обработчиков планирует в mutate-фазу сверку: если
  `el.value !== текущее значение биндинга` — откатить с восстановлением каретки.
  Это закрывает случай «обработчик отверг ввод, сигнал не изменился, эффект не
  перезапустился, DOM разъехался со стейтом».

#### Списки

- `<For each keyed fallback>` — `mapArray` + `insertExpression` (LIS-дифф).
- `<For … order="manual" orderKey={item => …}>` — порт `renderFastListChildren`:
  удалить отсутствующие → новые вставить пачками через `DocumentFragment`
  (prepend/append) → сохранённые **не двигать**, кроме тех, у кого изменился
  `orderKey`. Нужен там, где визуальный порядок задаётся `transform`'ом, а
  DOM-порядок должен оставаться стабильным (ChatList в telegram-tt).

### 3.4 `stricterdom`

Порт `teact/src/lib/fasterdom/stricterdom.ts` и `layoutCauses.ts` как есть:
патч геттеров/методов, вызывающих layout (`offsetWidth`, `getBoundingClientRect`,
`getComputedStyle`, `focus`, …) → ошибка, если `phase !== 'measure'`;
`MutationObserver` на `document.body` → ошибка, если мутация при
`phase !== 'mutate'`. Detached-узлы игнорируются (`document.contains`), поэтому
создание поддеревьев в pure-подфазе нарушением не считается. `data-*` атрибуты и
`contentEditable` исключены. `forceMeasure`, `forceMutation`, `suppressStrict`,
`setHandler` — как в teact. Включается только в dev (`enableStrict()`).

Следствие архитектуры: поскольку **все** записи в живой DOM идут через mutate-фазу,
любая точка вне её — безопасное окно для чтения layout. В teact это соглашение,
у нас — проверяемый инвариант.

### 3.5 `vite`

`frameact/vite` — плагин, который подключает `@solidjs/babel-plugin` с
`moduleName: "frameact/dom"`, `generate: "dom"`, `delegateEvents: true`,
`builtIns` по умолчанию. Версия плагина пинится (`2.0.0-rc.14` на момент
написания); обновление — осознанное, под acceptance-тест.

## 4. Структура репозитория

```
frameact/
  package.json            name: frameact; exports: ".", "./dom", "./scheduler",
                          "./stricterdom", "./vite", "./jsx-runtime" (типы)
  src/
    core/                 форк maverick + effects.ts (фазы), context.ts, map.ts (+key fn)
    scheduler/            fasterdom.ts, schedulers.ts, heavyAnimation.ts
    stricterdom/          stricterdom.ts, layoutCauses.ts
    dom/                  template.ts, insert.ts, props.ts, events.ts, controlled.ts,
                          list.ts (For/manual order), flow.ts (Show/Switch/Dynamic/Portal),
                          render.ts, index.ts
    vite/                 index.ts
    jsx/                  jsx.d.ts (из dom-expressions)
  test/                   vitest + jsdom
  bench/                  teact/, solid2/, frameact/ — одно приложение, три реализации
  examples/               минимальный чат-лист + список сообщений
  docs/superpowers/specs/
```

Третьесторонний код (maverick, dom-expressions, teact) вендорится с сохранением
копирайтов в `THIRD_PARTY_LICENSES.md`.

## 5. Тестирование

**Юнит (vitest + jsdom).** rAF в тестах — через `flushSync()` и fake timers.

- core: алмаз зависимостей без глитчей, динамические зависимости, dispose
  поддерева, `mapArray` по ключу (обновление строки на месте при смене ссылки,
  перестановки, удаления).
- effects: measure-эффекты выполняются раньше mutate-эффектов в кадре; запись
  сигнала из measure-applier применяется **в этом же** кадре; из mutate-applier —
  в следующем; одна запись, загрязнившая N эффектов, даёт один rAF; cleanup перед
  повторным apply и при dispose; `createEffect` (onTickEnd) не ждёт кадра;
  `createIdleEffect` ждёт окончания heavy animation; кастомный `schedule`
  (`requestForcedReflow`) вызывается с `run`; ошибка в apply не прерывает остальные.
- scheduler: порядок очередей fasterdom, throttling, таймаут-фолбэк, forced reflow.
- heavyAnimation: blocking откладывает проход и выполняет его **один раз** по
  окончании; non-blocking не влияет на ядро; счётчики и авто-таймаут.
- dom: дифф классов сохраняет императивные; `style`-объект per-property;
  контролируемый инпут откатывает отвергнутый ввод и сохраняет каретку;
  `order="manual"` не двигает сохранённые ноды, двигает при смене `orderKey`,
  prepend/append пачкой.
- stricterdom: ловит чтение layout в mutate и запись в measure; игнорирует detached.

**Acceptance-тест рантайма.** Все `__dom_fixtures__` из `@solidjs/babel-plugin`
компилируются с нашим `moduleName`; проверяется, что каждый импортируемый символ
экспортирован из `frameact/dom` и фикстуры рендерятся без исключений. Это и
спецификация API рантайма, и защита от изменений компилятора при обновлении.

**Бенч (Playwright, реальный Chromium, трейс).** Одно приложение в трёх
реализациях (teact, Solid 2.0, frameact):

| Сценарий | Что меряем |
|---|---|
| Первичный рендер 1000 сообщений | время до первого кадра |
| Prepend/append по 50 сообщений | long tasks, forced layouts |
| Стриминг: обновление текста одной строки каждый кадр 5 с | dropped frames |
| ChatList 100 чатов, случайный чат наверх каждые 100 мс, CSS-переезд | dropped frames, DOM moves |
| Скролл с измерением sticky-заголовков | forced synchronous layouts |
| JS-анимация панели 300 мс + 20 обновлений стора в процессе | dropped frames во время анимации |

Критерии успеха v1: forced synchronous layouts = 0 в strict-режиме; dropped frames
во время анимации не хуже teact; сырая пропускная способность не хуже 1.3× от
Solid 2.0. Если frameact не лучше голого Solid по thrash/dropped frames —
архитектура не оправдала себя, и это выясняется до написания клиента.

## 6. Вне скоупа v1

- Слой стора (`withGlobal` / action handlers) — в приложении. В пакете только
  `createSelector`-подобные хелперы.
- Роутер, SSR, hydration, `Loading`/`Errored`-границы, async-мемо, optimistic,
  транзакции.
- Per-subtree гейтинг heavy animation (архитектурой не закрыт, оставлен на потом).
- Девтулзы сверх stricterdom.
- Гейтинг non-blocking анимаций в ядре.

## 7. Риски

- **Компилятор 2.0 — RC.** Выход эмиттера может измениться. Защита: пин версии +
  acceptance-тест на фикстурах.
- **Первый `apply` синхронно при создании** — если компонент создаётся внутри
  mutate-applier (например, `insert` родителя), его дочерние записи идут в detached
  DOM и это нормально; но если кто-то создаст корень через `createRoot` внутри
  measure-applier и тут же вставит в живой DOM — stricterdom это поймает.
- **Порядок appliers = порядок постановки.** Для DOM это достаточно (детские
  appliers встают раньше родительского attach). Если найдутся случаи, где нужна
  сортировка по глубине owner'а, добавим `_depth` при постановке — задел есть.
- **Семантика записи «сразу»** отличается от teact: код, рассчитывающий на
  `nextValue`-поведение, переносить буквально нельзя. Осознанно.
