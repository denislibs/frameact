# frameact — дизайн v1

Дата: 2026-10-11. Статус: ревизия 2 — после adversarial review (см. §9).

## 1. Что это и зачем

**frameact** — fine-grained реактивный UI-фреймворк на сигналах, который реализует
принципы рендеринга teact (Telegram Web A):

- **один проход на кадр** — вся работа графа и все записи в DOM планируются в один
  `requestAnimationFrame`, по одной задаче на фазу;
- **явные фазы** `measure → mutate → forced-reflow measure → forced-reflow mutate` —
  чтение layout никогда не перемежается с записью в DOM;
- **гейтинг тяжёлых анимаций** — во время blocking-анимации кадровая работа
  откладывается целиком (атомарно, не по половине кадра), глобально или для поддерева;
- **stricterdom** — dev-режим, который ловит нарушения фаз на уровне DOM API и
  называет виновный эффект.

Вместо VDOM и ре-рендера компонентов — реактивный граф и точечные обновления DOM
(модель SolidJS). Компонент выполняется один раз; обновляются только биндинги.

Целевой потребитель — клиент мессенджера масштаба Telegram Web A: длинные списки,
высокочастотные обновления стора, много CSS/JS-анимаций, iOS Safari, mid-range Android.

### Чем это отличается от существующего

| | teact | Solid 1.x / 2.0 | frameact |
|---|---|---|---|
| Обновление | VDOM-дифф, ре-рендер компонента | fine-grained | fine-grained |
| Когда флашится | rAF, один проход | микротаск | rAF, один проход |
| Фазы measure/mutate | да | нет | да |
| Гейтинг анимаций | глобальный | нет | глобальный + per-subtree |
| Проверка нарушений фаз | stricterdom | нет | stricterdom + атрибуция до эффекта |

## 2. Принятые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Ядро сигналов | Форк `maverick-js/signals` v6 (MIT, ~1k строк), вендорится в `src/core` | Код прост и закончен; планировщик там — одна функция, которую мы заменяем. Полное владение. `@solidjs/signals` 2.0 — 18k строк RC с транзакциями/lanes, флаш в микротаске захардкожен |
| Компилятор | `@solidjs/babel-plugin` 2.0 с `moduleName: "frameact/dom"` | Эмитит двухфазные эффекты `_$effect(compute, apply)` — чистое вычисление и DOM-запись уже разделены. Писать свой компилятор — отдельный проект |
| DOM-рантайм | Порт `dom-expressions` 1.x client (MIT), адаптированный к API, которое импортирует компилятор 2.0 | Стабилен годами, ~1k строк, не завязан на RC-семантику 2.0 |
| Flow-компоненты | Свои `For`/`Show`/`Switch`/`Match`/`Dynamic`/`Portal` поверх `mapArray` | ~300 строк; `solid-js` тянет `@solidjs/signals` |
| API для авторов | Чистый Solid-стиль: компонент выполняется один раз, пропсы-геттеры | Hooks-прослойка поверх fine-grained даёт худшее из обоих миров. Код из telegram-tt не переносится 1:1 — осознанно |
| Эффекты | Двухфазные `createEffect(compute, apply, schedule)`; **фаза = планировщик**; фасады `createEffect` / `createMeasureEffect` / `createMutationEffect` / `createIdleEffect` / `createRenderEffect` | Как `throttleWith(requestMeasure, fn)` в teact. Без строковых опций и без `equals` |
| Кадровые планировщики | Батчирующие очереди: одна fasterdom-задача на фазу на кадр; гейт сэмплируется один раз на дрен | Прямой `requestMeasure(run)` на каждый эффект давал частично применённые кадры, релиз гейта вне фаз и записи из compute, уезжающие в следующий кадр (§9) |
| Семантика записи | `set()` обновляет значение сразу, чтение сразу видит новое; эффекты ждут своего планировщика | Как Solid 1.x. Проще teact'овского `nextValue`, минусов для целевого приложения не найдено |
| Гейтинг анимаций | Blocking гейтит кадровые очереди по умолчанию; non-blocking — только стор и явный opt-in через `gateOnHeavyAnimation`; оба — глобально и per-subtree через scope. Scope гейтит **обновления**, не создание поддерева | Паритет с teact/TeactN; «гейтить всё на non-blocking» заставило бы локальные UI-анимации ждать чужие |
| Стор | `frameact/store` — порт TeactN: приватный сигнал с иммутабельным стейтом, action handlers, `withGlobal` через bridge-сигнал на scope | Целевое приложение построено на этой модели; гейтинг распространения требует интеграции с ядром |
| Контролируемые инпуты | Директивы `use:value` / `use:checked`, не атрибут `value=` | Компилятор 2.0 эмитит `el.value = v` напрямую — рантайму перехватить нечего (проверено по фикстурам) |
| События | Соглашения Solid: `onClick`, `onInput`, делегирование через document; `on:name` для нативных | Компилятор эмитит `addEvent(el, name, handler, delegate)` под эту модель |
| Refs | `ref={el => …}` / `ref={variable}` | Solid-стиль |
| Ошибки | Ошибка в compute/apply логируется (или уходит в ближайший `onError`-scope), узел остаётся CLEAN с предыдущим применённым значением, кадр продолжается | Teact'овская устойчивость. Solid 2.0 останавливает реактивность целиком — для мессенджера неприемлемо |
| Структура | Один пакет с subpath-экспортами | Монорепа не нужна до второго потребителя |

## 3. Архитектура

```
frameact                 — сигналы, эффекты и планировщики, flow-примитивы, heavyAnimation
frameact/scheduler       — fasterdom: rAF, фазы, requestMeasure/Mutation/ForcedReflow
frameact/dom             — рантайм для компилятора (moduleName), render, For/Show/…, директивы
frameact/stricterdom     — dev-only контроль фаз с атрибуцией
frameact/store           — глобальный стор: TeactN на сигналах
frameact/vite            — Vite-плагин (обёртка @solidjs/babel-plugin)
```

Зависимости: `dom → core → scheduler`; `store → core`; `stricterdom ← scheduler`
(планировщик вызывает `setPhase`), `stricterdom ← core` (атрибуция, dev). `core` не
знает про DOM.

### 3.1 `scheduler` — fasterdom

Порт `teact/src/lib/fasterdom/fasterdom.ts` и `util/schedulers.ts`:

- `fastRaf(cb, withTimeoutFallback)` — объединяет колбэки в один rAF; фолбэк 35 мс
  через `setTimeout` для фоновых вкладок и iOS.
- Проход кадра:
  ```
  rAF:
    setPhase('measure');  measureTasks()
    microtask: setPhase('mutate');  mutationTasks()
    microtask: setPhase('measure'); forcedReflowTasks() → собирают mutation-колбэки
    microtask: setPhase('mutate');  forcedReflowMutationTasks()
    setPhase('measure')
  ```
  Микротаски между фазами нужны, чтобы колбэки `MutationObserver` stricterdom'а
  приходили с правильной фазой — порядок сохраняется как в teact.
- API: `requestMeasure(cb)`, `requestMutation(cb)`, `requestNextMutation(cb)`,
  `requestForcedReflow(cb)`, `onTickEnd`, `onIdle`, `throttleWith`.
- Сырые очереди fasterdom **не гейтятся** heavy animation — анимации пишут свои
  кадры через `requestMutation`, как в teact. Задачи, добавленные во время
  выполнения сырой очереди, уходят в следующий кадр (как в teact); очереди
  **run'ов** ядра (§3.2) дренируются до пустоты — это разные вещи.
- `flushSync()`: синхронный дрен всех четырёх очередей с корректным `setPhase`
  и сбросом `waiting` у throttle; реентер — ошибка в dev. Гейт `flushSync` **не**
  обходит. Нужен для тестов; `render()` в нём не нуждается (§3.3).

### 3.2 `core` — сигналы и эффекты

Файлы из maverick: `core.ts`, `signals.ts`, `map.ts`, `selector.ts`, `types.ts`,
`symbols.ts`. Алгоритм графа — Reactively: `CLEAN/CHECK/DIRTY`, `updateCheck`. Хранение
графа и правила latch'а изменены правками ниже. Меняется и то, что происходит, когда
эффект становится грязным.

#### Правки в maverick

1. **Граф на связях (как в alien-signals).** Вместо массивов `_sources`/`_observers`
   ребро — объект `Link` в двух двусвязных списках: в deps подписчика и в subs
   зависимости. Владение остаётся отдельным деревом: дети owner'а — интрузивный двусвязный
   список (`_lastChild`, `_prevSibling`/`_nextSibling`), добавление и удаление за O(1).
   Dispose итеративный (глубина дерева не ограничена стеком): дети раньше owner'а, в обратном
   порядке создания, поддерево ребёнка раньше него самого. Cleanup, который во время dispose
   диспозит соседа, потомка или предка, видит согласованное дерево; уже задиспозенные узлы
   повторно не диспозятся.
   - Подписчик линкуется **по завершении чтения**, то есть после pull читаемой memo.
     Если pull бросил, линковка всё равно происходит; если pull задиспозил сам dep —
     нет.
   - Повторный прогон с тем же порядком чтений переиспользует связи по курсору
     `_depsTail` (без аллокаций). Связи, не прочитанные до конца compute, снимаются.
   - `version` связи — номер прогона подписчика, в котором она подтверждена.
   - `notify`/`updateCheck` итеративные (явный стек, реентерабельны), обход — pre-order
     DFS. Уровень обхода помнит номер прогона, на котором в него вошли. Связь,
     подтверждённая позже, пропускается: её compute начался после пометки узла и прочитал
     его свежим.
2. **Missed-wake latch.** Иначе запись в собственный источник во время compute
   (compute компонента вызывает экшен, который пишет в стор, который читает
   контейнер-предок) теряется: `notify` выходит по `_state >= DIRTY`, а `finally`
   ставит CLEAN. Наивный фикс «CLEAN до compute» неверен: ленивый pull computed'а
   внутри compute пишет свежий результат и даёт лишний пересчёт (ломает glitch-free
   «jagged diamond»).

   Поэтому узел помечается `F_COMPUTING` (бит в `_flags`), и `notify` на вычисляющийся
   узел **латчит** (`F_MISSED`):
   - запись сигнала — всегда;
   - запись результата computed'а — только если связь, по которой она пришла, уже
     подтверждена в текущем прогоне (`link.version === _depsTail.version`): значение
     прочитано и устарело. Иначе это ленивый pull, который прочитают свежим.

   Новая связь латчит сама, если dep записан после начала compute (`_writtenAt` против
   эпохи начала) или после своего pull остался не-CLEAN (сам себя залатчил). Исключение —
   dep ещё в своём `update()`.

   По окончании compute залатченный узел ре-дёргается обычным `notify(DIRTY)` (эффект
   перепланируется; dev-guard: 100 итераций → ошибка). Тот же механизм, что
   `REACTIVE_MISSED_WAKE` в Solid 2.0.
3. **Нет повторного входа в `update()`.** Синхронный эффект, разбуженный записью из
   compute memo (или её записью результата), может прочитать memo до конца её `update()`.
   Тогда пересчёта нет: читатель получает текущее значение, у узла ставится
   `F_REENTERED`. Изменившийся результат дойдёт до читателя обычным `notify`. Первый
   результат при `F_REENTERED` анонсируется подписчикам, если он `!==` значения `initial`,
   которое они видели.
4. **Пересканы в `updateCheck`.** Запись сигнала во время проверки deps узла может снова
   загрязнить уже проверенный dep. Источники такой записи: dep, залатчивший свою запись;
   пишущая memo, пересчитанная позже; синхронный эффект. Её `notify` останавливается на
   узле (он уже CHECK), и пометить его CLEAN значило бы оставить его устаревшим навсегда.

   Поэтому:
   - узел помнит `writeEpoch` на начало своего скана;
   - если при разрешении эпоха сдвинулась и какой-то dep снова CHECK/DIRTY (не считая
     dep, который ещё в своём `update()`), deps проверяются заново;
   - после `MAX_RESCANS` (4) узел пересчитывается консервативно. Это защита от compute,
     который бесконечно пишет то, что читает: его compute тянет deps, их следующие записи
     латчат узел, и на один pull приходится ограниченное число прогонов.
5. **`runTop` в ядре не используется** (см. жизненный цикл). `updateCheck` на
   `DISPOSED`-узле — no-op, а не перевод в `CLEAN`: DISPOSED-dep пропускается,
   DISPOSED-узел остаётся как есть. Задиспозенный узел снимает свои связи из subs
   зависимостей. Подписчики держат связи к задиспозенному dep до своего следующего
   прогона.

#### Эффекты: две половины, фаза = планировщик

```ts
type Schedule = (run: () => void, node: EffectNode) => void;

createEffect(compute, apply, schedule: Schedule = tickEnd)
// compute: (prev) => T                      — трекается, чистый, без DOM
// apply:   (value, prev) => void | cleanup  — без трекинга; здесь побочные эффекты

// фасады — публичный API
createEffect(compute, apply)          // tickEnd (микротаск): логика без DOM — сеть, стор
createMeasureEffect(compute, apply)   // frameMeasure: чтение layout
createMutationEffect(compute, apply)  // frameMutation: запись в живой DOM
createIdleEffect(compute, apply)      // idle: фоновая работа, когда нет анимаций
createRenderEffect                    // alias createMutationEffect — имя, которое ждёт компилятор

// кастомные планировщики
createEffect(c, a, frameForcedReflow)  // measure после mutate в том же кадре
createEffect(c, a, (run) => onIdle(run))
```

`Schedule` получает узел вторым аргументом: планировщик читает из него scope
(§heavyAnimation) и dev-метаданные. Поэтому `gateOnHeavyAnimation(requestMutation)`
можно безопасно создать один раз на уровне модуля.

Синхронный кастомный `Schedule` (`(run) => run()`) запускает эффект прямо из обхода `notify`:
эффект видит промежуточные состояния графа (ещё не помеченные memo) и платит повторными
прогонами — примерно по одному на каждый путь от записанного сигнала к эффекту. Планировщики на
очередях (`tickEnd`, кадровые очереди) запускают run после обхода и этой цены не платят.

**Поля узла:** `_value` (результат последнего compute), `_applied` (значение,
переданное в последний `apply`; сентинел `NOT_APPLIED` до первого), `_applyCleanup`,
`_scope` (heavy-animation scope, снимается при создании), `_schedule`; в dev —
`_name` (из компилятора или фасада), ссылка на owner с именем компонента.

**Жизненный цикл:**

1. *Создание.* `compute` выполняется синхронно (трекается, под текущим owner).
   Дальше — различие фасадов:
   - **mutation/render-эффекты:** `apply` выполняется **синхронно**. Нужно для
     атомарного создания поддерева: узлы в этот момент detached, stricterdom такие
     записи не считает нарушением (§3.4).
   - **все остальные** (`tickEnd`, `measure`, `idle`, кастомные): первый запуск — через
     `schedule(run, node)`. Measure-эффект, созданный внутри compute `insert`'а,
     впервые выполняется после attach, в следующей measure-фазе, и видит реальный
     layout. (`focus()`, `offsetHeight`, `scrollTop`-восстановление на монтировании —
     главный паттерн tt.)
2. *Загрязнение.* `notify` maverick'а при переходе из `CLEAN` → `schedule(run, node)`.
   Один вызов на грязный период — это и есть дедуп.
3. *`run`:*
   - узел `DISPOSED` → выход;
   - по owner-цепочке есть эффект в состоянии ≠ `CLEAN` → **выход без работы**
     (узел запоминается у ближайшего такого предка и перепланируется, когда тот
     закончит свой `run` — успешно или с ошибкой): его собственный `run` сделает
     cleanup и пересоздаст поддерево, этот узел будет задиспозен. Compute предка
     никогда не выполняется из чужого `run`. Сначала проверяется **вся** цепочка на
     эффекты; только если все чисты, грязные memo-предки дотягиваются сверху вниз;
   - `_state = CLEAN`; пересчёт `compute` как computation графа (трекается). Первый
     compute упал → apply не вызывается вовсе. Если результат `=== _applied` — конец;
   - иначе: `_applyCleanup?.()`, `apply(_value, _applied)` без трекинга и **без
     owner** (как Solid 2.0): cleanup apply-половины — это **возвращённая функция**,
     она → `_applyCleanup`. `onCleanup` и создание owned-вычислений внутри apply —
     dev-ошибка (иначе одинаковый пересчёт compute сносил бы их без повторного apply);
     осознанное владение — через `runWithOwner`. `_applied = _value` — только если
     apply не бросил.
4. *Два канала cleanup.* `onCleanup` из compute (maverick `_disposal`) — перед каждым
   пересчётом compute и при dispose. `_applyCleanup` — **только** перед следующим
   `apply` и при dispose. Если dispose случился вне mutate-фазы (memo с условным
   поддеревом пересчитан при чтении в обработчике события), apply-cleanup'ы
   не выполняются на месте, а ставятся в кадровую mutate-очередь — иначе
   `classList.remove`/`disconnect` на attached-узлах выполняются в event handler.
5. *Ошибки.* Исключение в compute или apply → `handleError` по owner-цепочке
   (maverick `onError`); если не поймано — `console.error` с путём эффекта. Узел
   остаётся `CLEAN` (задиспозенный — `DISPOSED`), `_applied` не меняется, следующее
   изменение запускает снова (apply с тем же значением повторится). Остальные run'ы
   дрена выполняются; дети, ожидавшие этот узел, перепланируются.

Своя сравнивалка результата — `createMemo(fn, { equals })` в compute-половине;
`options.equals` у эффектов нет. Компилятор для `style`/`classList` возвращает новый
объект при каждом пересчёте → apply на каждый пересчёт источника; per-property дифф в
applier'е делает это безвредным (Solid 2.0 живёт так же).

#### Кадровые планировщики — батчирующие очереди

`frameMeasure`, `frameMutation`, `frameForcedReflow` — не прямые `requestMeasure(run)`,
а обёртки над **тремя очередями run'ов** в ядре:

```
frameMutation(run, node):
  mutationRuns.push({ run, node })
  if (!mutationTaskScheduled) requestMutation(drainMutation)   // одна задача на фазу на кадр

drainMutation():
  snapshot = { global blocking, per-scope blocking }   // один раз на дрен
  for (i = 0; i < mutationRuns.length; i++)             // живой массив: добавленные
    { run, node } = mutationRuns[i]                     //   в ходе дрена выполняются в этом же дрене
    if (node disposed) continue
    scope = firstBlockingScope(node._scope, snapshot)   // цепочка scope → parent → … → root
    if (scope) { scope.parked.push(entry); ensureRelease(scope); continue }
    run()
  mutationRuns = []                                      // guard: эффект запущен 100 раз за дрен → цикл, перенос на кадр
```

Следствия (это то, что раньше спека приписывала «фаза = планировщик», но что в
реальности даёт только батчирование):

| Ситуация | Что происходит |
|---|---|
| N эффектов загрязнены одной записью | один rAF, одна задача на фазу, порядок — порядок постановки |
| mutate-эффект загрязнён из compute в mutate-фазе (`mapArray` пишет `item`/`index`-сигналы внутри compute `insert`'а) | **этот же** дрен — текст сообщения обновляется в том же кадре, что и перестановка |
| mutate-эффект загрязнён из mutate-applier | этот же дрен (guard защищает от циклов) |
| mutate-эффект загрязнён из measure-applier | mutate-фаза этого же кадра |
| measure-эффект загрязнён из mutate-applier | следующий кадр; в dev — предупреждение «measure-эффект X загрязнён из mutate-фазы — уедет на кадр» |
| нужно measure после mutate в том же кадре | `frameForcedReflow` |
| mutate-эффект загрязнён из forced-reflow applier (FLIP: mutate → измерение → mutate) | forced-reflow mutate-фаза **этого же** кадра (и в `flushSync`) |
| applier №3 начал blocking-анимацию | №4…N **выполняются** — гейт сэмплирован на входе в дрен; кадр атомарен |
| родитель пересоздал поддерево | дети задиспозены до своих `run` → пропускаются |

**Гейтинг и релиз.** Blocking-анимация (глобальная = корневой scope, или scope
узла по цепочке) паркует run в `scope.parked` — порядок сохраняется. На scope
регистрируется **одна** `once`-подписка на `isBlockingAnimating`; при релизе она
делает `requestMeasure(() => { re-enqueue parked в frameMeasure/frameMutation })`:
все отложенные run'ы попадают в **один следующий кадр в порядке фаз**, а не
выполняются синхронно в `transitionend`. Задиспозенные за время парковки узлы
отбрасываются при релизе. `tickEnd`- и `idle`-run'ы не гейтятся (логика не должна
ждать анимацию; idle и так её ждёт).

Отличие от teact: teact замораживает **всё** на blocking-анимации, включая
`setState`. У нас запись в сигнал проходит мгновенно (значение видно синхронно,
например в обработчике), а откладывается только кадровая работа.

Порядок внутри очереди — порядок постановки, который равен порядку уведомления
(pre-order DFS по спискам подписчиков). Подписчик встаёт в список зависимости по завершении
первого чтения в прогоне (связи — двусвязные списки, как в alien-signals), повторный прогон
сохраняет его место, отписка не переставляет остальных. Это **не** гарантия «родитель раньше
ребёнка» (ребёнок, прочитавший сигнал раньше родителя, стоит раньше). Ничто в дизайне на этот
порядок не полагается: атомарность поддерева даёт синхронный первый apply, пересоздание —
правило «предок не CLEAN → выход».

#### Остальное API core

- `createSignal(value, { equals? })` → `[get, set]`; `createMemo(fn, { equals? })`;
  `createRoot(fn)`; `onCleanup(fn)`; `untrack`; `peek`; `getOwner`; `runWithOwner`;
  `onError`.
- `createContext(default)` / `useContext(ctx)` поверх `setContext`/`getContext`.
- `createSelector` — из maverick как есть.
- `mapArray(list, mapFn, { keyed })`:
  - `keyed: true` (по ссылке) — `computedKeyedMap`; `keyed: false` (по индексу) —
    `computedMap`;
  - `keyed: (item) => key` — дифф по ключу, `mapFn(item: Accessor, index: Accessor)`.
    Обязательно для иммутабельных данных telegram-tt (объект сообщения
    пересоздаётся при каждом изменении, строка обновляется на месте). Дубликат ключа
    → dev-warning и fallback на индекс (как `key` в teact); смена ключа у того же
    объекта = remove + create. `mapArray` держит копию предыдущего массива до
    следующего пересчёта — ожидаемо.
- `flushSync()` — см. §3.1; дополнительно дренирует `tickEnd`-очередь.
- **`tickEnd` — один дрен до пустоты.** `flushTickEnd` крутит очередь, пока она не
  опустеет: колбэки, добавленные во время дрена (эффект → запись → эффект…), выполняются
  в нём же, без новых микротасков. Каскад завершается до любого микротаска, поставленного
  после записи.
- `batch` не нужен: эффекты и так ждут планировщика.

#### heavyAnimation: scope'ы и комбинатор

Порт `teact/src/teact/heavyAnimation.ts`, обобщённый до **scope'ов**:

```ts
const scope = createHeavyAnimationScope(parent?)
// { begin(duration = 1000, isBlocking = false): onEnd,
//   isAnimating: Signal<boolean>, isBlockingAnimating: Signal<boolean>,   // оба с .once
//   parent }

// глобальный API — это корневой scope
beginHeavyAnimation(duration?, isBlocking?)  = rootScope.begin
getIsHeavyAnimating / getIsBlockingAnimating = rootScope.isAnimating / .isBlockingAnimating
onHeavyAnimation(onStart, onEnd, scope = rootScope)   // замена хука useHeavyAnimation
onFullyIdle(cb, scope = rootScope)                    // через once, не опрос каждый кадр
```

Счётчики, авто-таймаут, идемпотентный `onEnd` — как в teact, на каждый scope.

**Per-subtree.** `<HeavyAnimationScope scope={scope}>` кладёт scope в context. При
создании эффекта ядро снимает ближайший scope из context в поле `node._scope`
(не хранит в `_context` каждого узла). Scope снимается **при создании**: дешевле,
и эффект не может «переехать». Проверка при дрене — по цепочке `scope.parent`.
Вложенный scope ждёт и внешний.

**Scope гейтит обновления, не создание.** Родительский `insert`, переключившийся
на `<HeavyAnimationScope><MessageList/></HeavyAnimationScope>`, создаёт список в
своём compute — в том же кадре, где начинается анимация. Для тяжёлых поддеревьев
штатный паттерн — `deferUntilIdle(scope, () => <MessageList/>, placeholder)`:
первый compute идёт через `createIdleEffect` этого scope, на время анимации стоит
плейсхолдер. (tt делает то же руками через `isReady`.)

**Non-blocking — комбинатор над планировщиком:**

```ts
gateOnHeavyAnimation(schedule, { blocking = false } = {}): Schedule
// (run, node) => анимация активна в цепочке node._scope
//                  ? scope.isAnimating.once(() => schedule(run, node))
//                  : schedule(run, node)
```

Кадровые очереди сами гейтятся только на blocking. Ждать и non-blocking — явный
opt-in. Стор использует комбинатор для bridge-эффекта (§3.5).

### 3.3 `dom` — рантайм

Контракт задаёт компилятор: набор импортов из `moduleName`. Полный список фиксируется
acceptance-тестом (§5); ожидаемый состав: `template`, `insert`, `effect`, `memo`,
`createComponent`, `spread`, `assign`, `mergeProps`, `setAttribute`, `setAttributeNS`,
`setProperty`, `className`, `style`, `setStyleProperty`, `addEvent`, `delegateEvents`,
`ref`/`applyRef`, `use`, `readShallow`, `Portal`, `Dynamic`, `For`, `Show`, `Switch`,
`Match`.

База — `dom-expressions` 1.x `client.js`, с изменениями:

- `effect(compute, apply, options?)` → `createRenderEffect`; `options.name` от
  компилятора (`sourceNames.bindings`: `span.textContent`, `div.class:active`) кладётся
  в `node._name` (dev). `createComponent(Comp, props, name)` — имя на owner.
- `insert(parent, accessor, marker, init, options?)`: compute = `normalize(accessor())`
  (создание поддеревьев — чистый JS над detached DOM), apply = `insertExpression`.
  Дифф массивов — `reconcileArrays` из dom-expressions.
- **Классы.** Все пути записи класса (`class=` через `setAttribute("class")`,
  `className(el, obj)`, `classList`) идут через **дифф токенов** с `prev` на элементе:
  только `classList.add/remove` изменившихся. Императивные классы переживают
  реактивные обновления без реестра. `className=` на intrinsic-элементах у
  компилятора 2.0 — обычный атрибут → dev-ошибка «используй `class`».
- **Стили.** Объектная форма — per-property дифф; строковая — `cssText`.
  Документируется: строковый `style` несовместим с `setExtraStyles`.
- `render(code, el)`: `createRoot` → создать поддерево; первый apply корневого
  `insert` синхронный (§3.2), attach в attached-контейнер — через
  `forceMutation(cb, el)` stricterdom'а. Монтирование синхронное, `flushSync` не нужен.
  `Portal` — то же для своего mount-узла.

Хелперы для императивных анимаций (API-совместимость с teact):
`addExtraClass`, `removeExtraClass`, `toggleExtraClass`, `setExtraStyles` — тонкие
обёртки над `classList` / `style.setProperty`; stricterdom следит за фазой.

#### Контролируемые инпуты — директивы

Компилятор 2.0 для `<input value={s()}>` эмитит `_$effect(() => ({e: s(), …}),
({e}) => { _el$.value = e ?? "" })` — прямое присваивание, рантайм ничего не видит.
Поэтому контроль — явный примитив:

```tsx
<input use:value={text} onInput={e => setText(filter(e.currentTarget.value))} />
<input type="checkbox" use:checked={flag} onChange={…} />
```

`use:value` (компилятор эмитит `_$use(value, el, () => sig)`) делает:

- `createMutationEffect(() => sig(), v => setValueKeepingCaret(el, v))` — applier
  пишет только если `el.value !== v`; восстанавливает каретку по snapshot'у.
- один делегированный `input`-listener, выполняемый **после** пользовательских
  обработчиков: snapshot `selectionStart/End` (до любых записей этого тика), затем
  если `el.value !== sig()` — **синхронный** откат через ту же
  `setValueKeepingCaret` (как teact; `.value` не виден MutationObserver, кадра
  мерцания нет). Принятый ввод (`sig() === el.value`) не трогается; отформатированный
  (`sig()` ≠ ввод) применяется сразу, без ожидания кадра.
- во время composition (`e.isComposing`, `compositionstart…compositionend`) запись в
  `el.value` не выполняется — иначе ломается IME.

Реактивный `value=`/`checked=` на `INPUT/TEXTAREA/SELECT` — dev-warning
«используй `use:value`». `selectionStart/End` добавляются в `layoutCauses` stricterdom'а:
читать их можно только в measure-фазе (обработчик события — measure).

#### Списки

- `<For each keyed fallback>` — `mapArray` + `insertExpression` (LIS-дифф).
- `<For each order="manual" orderKey={item => …}>` — порт идеи `renderFastListChildren`
  для случаев, когда визуальный порядок задаётся `transform`'ом по `index()`, а
  DOM-порядок должен оставаться стабильным (ChatList). Контракт:
  - `For` в этом режиме **владеет своим DOM-диапазоном**: удаляет отсутствующие,
    новые вставляет пачками через `DocumentFragment` (prepend/append), сохранённые
    **не двигает**, кроме тех, у кого изменился `orderKey`;
  - наружу `insert`'у возвращает массив узлов в **DOM-порядке**, а не в порядке
    списка — тогда `reconcileArrays` видит только вставки и удаления и ничего не
    переставляет;
  - `orderKey(item)` вычисляется в compute `For` без трекинга и хранится per key между
    пересчётами; сам по себе не реактивен — перестановка происходит при следующем
    пересчёте списка;
  - dev-assert: `For order="manual"` — единственный ребёнок своего элемента, без
    `fallback` (позиционирование относительно собственного диапазона, не
    `childNodes[i]`).

### 3.4 `stricterdom`

Порт `teact/src/lib/fasterdom/stricterdom.ts` и `layoutCauses.ts`: патч
геттеров/методов, вызывающих layout → ошибка, если `phase !== 'measure'`;
`MutationObserver` на `document.body` → ошибка, если мутация при `phase !== 'mutate'`.
Detached-узлы игнорируются (`document.contains`), поэтому создание поддеревьев
нарушением не считается. `data-*` и `contentEditable` исключены. `forceMeasure`,
`forceMutation`, `suppressStrict`, `setHandler` — как в teact. Включается в dev
(`enableStrict()`). `layoutCauses` дополняется `selectionStart/selectionEnd`.

**Атрибуция.** Ядро в dev держит `currentEffect` на время `run`. Обработчик по
умолчанию дополняет ошибку путём: `Message > MessageMeta > span.textContent [mutate]`
(имена компонентов — третий аргумент `createComponent`, имена биндингов —
`sourceNames.bindings`, фаза — планировщик эффекта, scope — если есть). Туда же:
«slow run» (> 7 мс) с тем же путём и предупреждение «measure-эффект загрязнён из
mutate-фазы».

Следствие архитектуры: поскольку **все** записи в живой DOM идут через mutate-фазу,
любая точка вне её — безопасное окно для чтения layout. В teact это соглашение, у
нас — проверяемый инвариант с именем нарушителя.

### 3.5 `store` — TeactN на сигналах

```ts
const {
  getGlobal, setGlobal, getActions, getPromiseActions,
  addActionHandler, withGlobal, addCallback, removeCallback, execAfterActions,
} = createGlobalStore<GlobalState, ActionPayloads>()
```

**Хранение.** Приватный сигнал `global` с иммутабельным объектом — наружу **не**
экспортируется (чтение сырого сигнала в JSX обошло бы non-blocking гейт). `getGlobal()`
— untracked. `setGlobal(next, options?)` пишет сразу. Dev-проверка устаревшего global:
`WeakMap<object, epoch>` — `getGlobal()` штампует объект текущей эпохой, `setGlobal`
бросает, если штамп объекта не равен текущей эпохе (`forceOutdated` отключает);
эпоха инвалидируется на tickEnd. Без копирования объекта — иначе каждый `getGlobal()`
дирти контейнеры.

**Распространение — bridge на scope.** Для каждого heavy-animation scope (лениво,
диспозится со scope) создаётся `[bridged, setBridged]` и один эффект:

```ts
createEffect(() => global(), v => setBridged(v), gateOnHeavyAnimation(tickEnd))
```

Контейнеры читают `bridged()` своего scope, не `global()`. Отсюда — ровно TeactN:
UI видит последний распространённый стейт, обработчики — текущий; во время
non-blocking анимации контейнеры не обновляются; десять `setGlobal` подряд —
один bridge-run (как `throttleWithTickEnd(runCallbacks)` в TeactN). **Одно решение о
гейте на флаш**, детерминированный порядок, единый dev-таймер «Slow containers update»
(> 7 мс на bridge-run).

- `forceOnHeavyAnimation` — bridge-эффект пропускает гейт на этом флаше (флаг
  потребляется bridge'ем, а не первым из N контейнеров).
- `forceSyncOnIOs` — `setBridged(next)` синхронно во всех bridge'ах внутри `setGlobal`.

**Экшены.** `addActionHandler(name, (global, actions, payload) => State | void |
Promise<void>)`. Вызов `actions.name(payload, options?)` возвращает промис. Очередь с
сериализацией вложенных вызовов (`actionQueue.length === 1` — не трогать) и
`execAfterActions` портируются из `teactn.tsx` как есть. Обработчики не гейтятся.

**Контейнеры.**

```ts
function Container(props) {
  const bridged = bridgeFor(currentScope());
  const mapped = createMemo(
    () => activate(props) ? mapState(bridged(), props) : untrack(mapped),   // stickToFirst внутри activate
    { equals: shallowEqual },
  );
  return <Component {...toGetters(mapped)} {...props} />;   // own props выигрывают, как в TeactN
}
```

- Изменение **пропсов** пересчитывает `mapState` немедленно (при чтении), без гейта —
  как `!arePropsShallowEqual(ownProps, props)` в TeactN. Во время анимации открытия
  чата `chatId` и `chat` не расходятся.
- Изменение **global** приходит через bridge — гейтится.
- `toGetters(mapped)` — геттер на ключ, за которым стоит ленивый `createMemo(() =>
  mapped()[key])` с `===`: биндинг на `isSelected` не перезапускается от смены
  `message`. Memo создаётся при первом обращении к ключу.

#### Стоимость — два паттерна для списков

*A. Контейнер на строке* (`withGlobal` на `Message`, как в tt). Любой `setGlobal` →
один bridge-run → 1000 memo `mapped` помечены грязными → при чтении биндингами
1000 × `mapStateToProps` + `shallowEqual`, 999 отброшены. Это стоимость
`updateContainers` в TeactN, не меньше. Дальше дешевле teact'а благодаря per-key
геттерам, но порядок величины задаёт `mapStateToProps`.

*B. Контейнер на списке + `mapArray keyed: fn` + `item()`.* Один `mapStateToProps`
→ новый массив → O(n) дифф по ключам → `write` в item-сигналы (999 no-op по ссылке)
→ один compute строки → один apply. На порядок дешевле A. Требует, чтобы всё нужное
строке приходило через `item()` или через аксессоры-карты от списка
(`usersById()[item().senderId]`). **Это рекомендуемый паттерн и единственное место, где
frameact структурно выигрывает у teact на списках.** Бенч (§5) измеряет оба.

### 3.6 `vite`

`frameact/vite` подключает `@solidjs/babel-plugin` с:

```ts
moduleName: "frameact/dom", generate: "dom", delegateEvents: true,
builtIns: ["For", "Show", "Switch", "Match", "Portal", "Dynamic"],   // без Loading/Reveal/Errored/Repeat
sourceNames: dev,                                                     // имена биндингов и компонентов для атрибуции
```

Версия плагина пинится (`2.0.0-rc.14` на момент написания); обновление — осознанное,
под acceptance-тест.

## 4. Структура репозитория

```
frameact/
  package.json            name: frameact; exports: ".", "./dom", "./scheduler",
                          "./stricterdom", "./store", "./vite", "./jsx-runtime" (типы)
  src/
    core/                 форк maverick (+ правки §3.2), effects.ts (run, очереди run'ов,
                          планировщики, гейтинг), context.ts, map.ts (+key fn)
    scheduler/            fasterdom.ts (+flushSync), schedulers.ts, heavyAnimation.ts (scope'ы)
    stricterdom/          stricterdom.ts, layoutCauses.ts, attribution.ts
    dom/                  template.ts, insert.ts, props.ts (class token diff, style),
                          events.ts, directives.ts (use:value/use:checked),
                          list.ts (For, manual order), flow.ts (Show/Switch/Dynamic/Portal),
                          render.ts, index.ts
    store/                store.ts (сигнал, эпохи), bridge.ts, actions.ts, withGlobal.tsx
    vite/                 index.ts
    jsx/                  jsx.d.ts (из dom-expressions) + типы директив
  test/                   vitest + jsdom
  bench/                  teact/, solid2/, frameact/ — одно приложение, три реализации
  examples/               чат-лист + список сообщений (оба паттерна из §3.5)
  docs/superpowers/specs/
  THIRD_PARTY_LICENSES.md maverick, dom-expressions, teact (все MIT)
```

## 5. Тестирование

**Юнит (vitest + jsdom).** Кадр — через `flushSync()`; цепочки через микротаски —
`await flushMicrotasks()`, не fake timers.

- core: алмаз без глитчей; динамические зависимости; dispose поддерева; запись в
  собственный источник во время compute не теряется (правка 2, latch); `mapArray` по
  ключу — обновление строки на месте при смене ссылки, перестановки, удаления,
  дубликат ключа → warning + индекс, смена ключа = remove + create.
- effects: first-run — mutation синхронно, measure/tickEnd/idle через планировщик;
  **measure-эффект, созданный внутри insert-compute, впервые выполняется после attach
  и видит ненулевой layout**; `run` при не-CLEAN предке выходит, предок пересоздаёт
  поддерево один раз; `_applied` даёт корректный `prev` после пересоздания; запись
  из measure-applier → mutate того же кадра; из compute в mutate-дрене → тот же
  дрен; measure из mutate-applier → следующий кадр + dev-warning; guard на цикл;
  два канала cleanup — apply-cleanup не выполняется, если apply не последовал;
  dispose вне mutate откладывает apply-cleanup в mutate; ошибка в apply не
  прерывает дрен, узел CLEAN.
- scheduler: порядок четырёх очередей; throttling; таймаут-фолбэк; `flushSync`
  с реентером → ошибка; сырые задачи, добавленные в ходе фазы, → следующий кадр.
- heavyAnimation: blocking паркует весь дрен атомарно (applier, начавший анимацию,
  не прерывает текущий кадр); релиз — один следующий кадр, measure раньше mutate, в
  исходном порядке; одна `once` на scope; задиспозенные при релизе отброшены;
  `begin` внутри релиза не зацикливает; non-blocking не влияет на кадровые очереди,
  влияет на `gateOnHeavyAnimation`; scope: эффект внутри ждёт, соседний нет,
  вложенный ждёт внешний; `gateOnHeavyAnimation` на уровне модуля видит scope узла;
  `deferUntilIdle` откладывает первый compute.
- store: props-путь без гейта (смена `chatId` во время non-blocking анимации
  обновляет `chat`); global-путь гейтится; `forceOnHeavyAnimation` пропускает **все**
  контейнеры; `forceSyncOnIOs` синхронно; per-key геттер не дирти соседние
  биндинги; `shallowEqual`; `activationFn`/`stickToFirst`; own props поверх mapped;
  сериализация вложенных экшенов и `execAfterActions`; dev-ошибка на устаревший
  global без копирования объекта; контейнер в scope ждёт свой scope.
- dom: дифф токенов класса сохраняет императивные на всех путях записи; `style`-объект
  per-property; `use:value` — отклонённый ввод откатывается синхронно до paint,
  принятый не трогается, отформатированный применяется сразу с кареткой, composition
  не прерывается; `order="manual"` — сохранённые не двигаются, двигаются при смене
  `orderKey`, prepend/append пачкой, наружу DOM-порядок; `render` в attached-контейнер
  не даёт ошибки stricterdom.
- stricterdom: чтение layout в mutate / запись в measure → ошибка с путём
  `Component > binding [phase]`; detached игнорируется; `selectionStart` в mutate
  → ошибка.

**Acceptance-тест рантайма.** Все `__dom_fixtures__` из `@solidjs/babel-plugin`
компилируются с нашей конфигурацией; каждый импортируемый символ экспортирован из
`frameact/dom`, фикстуры рендерятся без исключений.

**Бенч (Playwright: Chromium + WebKit, CPU throttling ×4, трейс).** Одно
приложение в трёх реализациях (teact, Solid 2.0, frameact; у frameact — варианты
A и B из §3.5 для списков):

| Сценарий | Метрика |
|---|---|
| Cold start: размер бандла, TTI на 1000 сообщений | кб, мс |
| Первичный рендер 1000 сообщений | время до первого кадра |
| Prepend/append по 50 сообщений | long tasks, forced layouts |
| Одна реакция изменилась в списке 1000 (A и B) | JS time, число compute/apply |
| Стриминг: текст одной строки каждый кадр 5 с | dropped frames, задержка данные→кадр (должна быть 0 кадров) |
| ChatList 100 чатов, случайный наверх каждые 100 мс, CSS-переезд | dropped frames, DOM moves (= 0 в manual) |
| Скролл с измерением sticky-заголовков и подгрузкой картинок | forced synchronous layouts |
| Blocking-анимация 300 мс + 20 обновлений стора | dropped frames **во время**, longest task **после релиза**, time-to-updated-frame |
| Композер: ввод 60 wpm с фильтром | input latency keypress→paint p95; откат до paint |
| 200 переключений чатов | heap после, рост `once`/контекстов |

Критерии v1:
- `enableStrict()` — 0 ошибок stricterdom на всех сценариях;
- из трейса: число `Layout` с ненулевым dirty внутри скрипта за кадр ≤ числа
  `requestForcedReflow`-задач этого кадра;
- после релиза гейта: longest task не хуже teact'овского pass'а на том же объёме;
- стриминг и реакции: обновление в том же кадре, что и запись (нет однокадрового
  отставания);
- паттерн B быстрее teact на «одна реакция в 1000» минимум в 3 раза; паттерн A — не
  медленнее teact;
- WebKit: те же инварианты фаз (порядок микротасков/MutationObserver, фолбэк `fastRaf`).

Если frameact не выигрывает у teact по этим пунктам — архитектура не оправдалась,
и это выясняется до написания клиента.

## 6. Вне скоупа v1

- Роутер, SSR, hydration, `Loading`/`Errored`-границы, async-мемо, optimistic,
  транзакции.
- Селекторы стора по путям (fine-grained подписки на части global).
- Девтулзы сверх stricterdom-атрибуции.

## 7. Риски

- **Компилятор 2.0 — RC.** Выход эмиттера может измениться (включая форму
  `_$effect` и прямые присваивания). Защита: пин версии + acceptance-тест.
- **Дрен, читающий собственные добавления.** Делает возможным бесконечный цикл
  (эффекты дёргают друг друга). Guard считает **запуски одного эффекта** за дрен,
  а не число записей: эффект, запущенный 100 раз в одном дрене, считается циклом —
  `console.error` с его именем, его дальнейшие запуски переносятся на следующий кадр
  (dev и prod). Общего лимита записей нет: 10 000 независимых эффектов от одной записи
  применяются в одном кадре.
  Для `tickEnd` то же правило: счётчик запусков эффекта ведётся **за один дрен
  `flushTickEnd`** (эпоха дрена), а не за макрозадачу. Цикл — это самоподдерживающийся
  каскад без внешнего ввода; каждый `flushSync()` и каждый шаг `await` — новый дрен со
  свежим счётчиком, поэтому 5000 обновлений из сокета в `for await` или тысячи
  `flushSync()` подряд циклом не считаются. На 101-м запуске в дрене — `console.error`
  (один раз на эффект за дрен), запуск переносится на `setTimeout`: бесконечный цикл
  уступает event loop каждые 100 запусков. Общий self-dirty guard остаётся только для
  кастомных планировщиков; эффекты на `tickEnd` и кадровых очередях (и их
  `gateOnHeavyAnimation`-обёртках) он не считает повторно.
- **Правило «предок не CLEAN → выход».** Если предок по какой-то причине не будет
  перепланирован (ошибка в его compute), потомки застынут до следующего изменения
  предка. Ошибка в compute оставляет узел CLEAN (§3.2 п. 5) — потомки получат свой
  `run` при следующем загрязнении; тест на это обязателен.
- **Per-key memo в контейнерах** — память на 1000 строк × 40 ключей при паттерне A.
  Ленивое создание и бенч «200 переключений чатов» это контролируют; паттерн B
  рекомендован.
- **Семантика записи «сразу»** отличается от teact: код, рассчитывающий на
  `nextValue`-поведение, переносить буквально нельзя. Осознанно.

## 8. История решений

- Ревизия 1: Solid 2.0 signals отвергнут в пользу форка maverick (владение,
  флаш-функция заменяема, граф можно гонять в rAF). Компилятор — babel-plugin 2.0,
  рантайм — dom-expressions 1.x. API — чистый Solid-стиль. `options.phase` →
  «фаза = планировщик» с фасадами (без `equals`).

## 9. Изменения по итогам adversarial review (ревизия 2)

Два независимых ревьюера (оптика «мейнтейнер реактивного ядра» и «перф-инженер
telegram-tt») сошлись на трёх критических дефектах ревизии 1; всё ниже внесено.

| # | Было | Стало |
|---|---|---|
| C1 | `run` делал `runTop` по owner-цепочке | compute только из собственного `run`; «предок не CLEAN → выход»; `_applied` отдельно от `_value` |
| C2 | `requestMeasure(run)` на каждый эффект; гейт в каждом `run`; релиз `once(run)` | три очереди run'ов, одна fasterdom-задача на фазу; гейт один раз на дрен; парковка на scope, одна `once`, релиз через `requestMeasure` в один кадр |
| C3 | записи из compute в mutate-фазе уезжали в следующий кадр | дрен читает добавления; `mapArray` обновляет строку в том же кадре |
| C4 | первый `apply` синхронно у всех фасадов | только у mutation/render; остальные через планировщик |
| C5 | — | правка maverick: missed-wake latch (не «CLEAN до compute» — см. §3.2); `updateCheck` на DISPOSED — no-op |
| M1 | контейнер = сигнал + один гейченый эффект на props и global | memo по пропсам + bridge-сигнал на scope; `forceOnHeavyAnimation`/`forceSyncOnIOs` на bridge |
| M2 | контроль `value=` в рантайме | директивы `use:value`/`use:checked`, синхронный откат, IME |
| M3 | `order="manual"` + `orderKey` | For владеет DOM-диапазоном, наружу DOM-порядок, orderKey per key, dev-assert |
| M4 | один cleanup | два канала; apply-cleanup при dispose вне mutate → в mutate-очередь |
| M5 | «батчинг лучше TeactN», один сигнал mapped | раздел «Стоимость», per-key геттеры, бенч A/B |
| M6 | «scope гейтит рендер списка» | гейтит обновления; `deferUntilIdle` |
| M7 | `flushSync` не определён; `render` через `flushSync` | определён в §3.1; `render`/`Portal` через `forceMutation` |
| M8 | — | атрибуция stricterdom до эффекта, `sourceNames`, dev-предупреждения |
| M9 | бенч с нечитаемыми критериями | §5 переписан |
| minor | — | `Schedule(run, node)`; scope полем узла; `className` → dev-ошибка; явный `builtIns`; `onFullyIdle` через `once`; дубли ключей; порядок spread в `withGlobal`; приватный сигнал global; состояние узла после ошибки |

Отклонено: `options.equals` у эффектов (решение автора; per-property дифф делает
лишний apply безвредным, Solid 2.0 живёт так же).
