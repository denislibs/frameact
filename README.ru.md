<p align="center">
  <img src="docs/assets/social-preview-b.png" alt="frameact — fine-grained сигналы, один коммит на кадр" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Русский</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

# frameact

**Fine-grained сигналы. Один коммит на кадр.**

frameact — реактивный UI-фреймворк для приложений, где важен каждый кадр: мессенджер с историей на тысячи
сообщений, список чатов, который перестраивается прямо под пальцем, анимации, которые не должны дёргаться
на среднем телефоне. Он соединяет **fine-grained сигналы** (без виртуального DOM, компонент выполняется один
раз, обновляются только биндинги) с **дисциплиной кадра из [teact](https://github.com/Ajaxy/teact)** —
фреймворка, на котором написан Telegram Web A:

- **один проход на кадр** — вся реактивная работа и все записи в DOM собираются в один `requestAnimationFrame`;
- **явные фазы** — `measure → mutate → forced-reflow measure → forced-reflow mutate`: чтение layout никогда не
  перемежается с записью в DOM (нет layout thrashing);
- **гейтинг тяжёлых анимаций** — пока идёт блокирующая анимация, кадровая работа паркуется и выпускается одним
  кадром после её окончания — глобально или только для одного поддерева;
- **stricterdom** *(в планах)* — dev-режим, который ловит нарушения фаз на уровне DOM API и называет виновный эффект.

> **Статус: ранняя разработка.** Реактивное ядро ([PR #1](https://github.com/denislibs/frameact/pull/1)) и
> DOM-рантайм реализованы: `frameact/dom` для JSX-компилятора Solid 2.0
> (`@solidjs/babel-plugin@2.0.0-rc.14`), `render`, `For` (включая `order="manual"`),
> `Show`/`Switch`/`Match`/`Dynamic`/`Portal`, контролируемые инпуты (`use:value` / `use:checked`),
> `HeavyAnimationScope`, context `Provider` и Vite-плагин `frameact/vite`; стор (`frameact/store`: дерево
> сигналов с парковкой по причине на время тяжёлых анимаций) тоже готов. Дальше — stricterdom.
> В npm пока не опубликован, API может меняться.

## Зачем

Фреймворки на сигналах (Solid, Vue, Svelte 5, Preact Signals) флашат эффекты в микротаске, и каждый эффект
пишет в DOM сразу, как только выполнился. Если один эффект читает layout, а другой пишет, чтения и записи
перемежаются, и браузер снова и снова пересчитывает layout внутри одного кадра.

teact решает это для VDOM-рендерера библиотекой **fasterdom**: каждая операция с DOM — либо *измерение*, либо
*мутация*, и они раскладываются по разным фазам одного кадра анимации. frameact переносит ту же дисциплину на
fine-grained реактивность, где обновление — это один биндинг, а не ре-рендер компонента.

| | teact | Solid 1.x / 2.0 | frameact |
|---|---|---|---|
| Модель обновления | VDOM-дифф, ре-рендер компонента | fine-grained | fine-grained |
| Когда флашится | rAF, один проход | микротаск | rAF, один проход |
| Фазы measure / mutate | да | нет | да |
| Гейтинг анимаций | глобальный | нет | глобальный + по поддереву |
| Проверка нарушений фаз | stricterdom | нет | stricterdom + атрибуция до эффекта *(в планах)* |

## Как это работает

Эффект делится на две половины: отслеживаемый чистый **compute** и неотслеживаемый **apply**, который делает
побочное действие. *Фаза — это планировщик*: момент выполнения apply выбирается выбором фасада.

```ts
import {
  createSignal, createEffect, createMeasureEffect, createMutationEffect, createIdleEffect,
} from 'frameact';

const [height, setHeight] = createSignal(0);
const [expanded, setExpanded] = createSignal(false);

// фаза measure: читаем layout
createMeasureEffect(() => expanded(), () => setHeight(panel.offsetHeight));

// фаза mutate того же кадра: пишем в DOM
createMutationEffect(() => height(), (h) => { spacer.style.height = `${h}px`; });

// микротаск: логика без DOM (сеть, стор)
createEffect(() => expanded(), (open) => analytics.track('panel', { open }));

// когда браузер простаивает и ничего не анимируется
createIdleEffect(() => expanded(), () => prefetchDetails());
```

Что гарантирует кадр:

- N эффектов, загрязнённых одной записью → **один** rAF, одна задача на фазу;
- сигнал, записанный в measure-apply, доходит до mutation-эффектов **в этом же кадре**;
- записи, сделанные во время вычислений в mutate-фазе (например, keyed-список обновляет свои строки),
  попадают **в тот же дрен**;
- measure-эффект, загрязнённый из mutate-фазы, выполняется в следующем кадре (в dev — с предупреждением);
- `frameForcedReflow` — для редкого случая «mutate → measure → mutate» (FLIP), всё ещё в одном кадре.

Тяжёлые анимации:

```ts
import { beginHeavyAnimation, createHeavyAnimationScope, provideHeavyAnimationScope } from 'frameact';

const end = beginHeavyAnimation(300, /* isBlocking */ true); // запарковать всю кадровую работу до 300 мс
// …или только для поддерева: список чатов продолжает обновляться, пока колонка чата выезжает
const scope = createHeavyAnimationScope();
provideHeavyAnimationScope(scope);
scope.begin(300, true);
```

Компоненты пишутся в чистом Solid-стиле — выполняются один раз, пропсы-геттеры — и компилируются
JSX-компилятором Solid 2.0, настроенным на рантайм frameact (`moduleName: "frameact/dom"`):

```ts
// vite.config.ts
import frameact from 'frameact/vite';
export default { plugins: [frameact()] };
// tsconfig.json: "jsx": "preserve", "jsxImportSource": "frameact"
```

```tsx
import { createSignal } from 'frameact';
import { render } from 'frameact/dom';

function Composer() {
  const [text, setText] = createSignal('');
  return <input use:value={text} onInput={(e) => setText(e.currentTarget.value.trimStart())} />;
}
render(() => <Composer />, document.getElementById('app')!);
```

`class=` / `classList=` / спреды диффят токены классов, поэтому императивный `addExtraClass` переживает
обновления; строковый `style=` пишет `cssText` и несовместим с `setExtraStyles`. Контролируемые инпуты —
`use:value` / `use:checked`: реактивный `value=` пишется как свойство, и Vite-плагин предупреждает об этом в dev. Чтобы
протолкнуть значение через активную IME-композицию (например, очистить поле по «Отправить»), сначала обновите сигнал,
затем вызовите `forceControlledValue(el)` из обработчика пользовательского события (`isForcingControlledValue`
позволяет распознать этот цикл в ваших `blur`/`focus`).

**Безопасность.** Запись атрибутов отклоняет URL `javascript:` / `vbscript:`, `data:` не для медиа, строковые
обработчики `on*` и `srcdoc=`; явный выход для доверенного HTML — `prop:srcdoc`. В production отказы тихие, в DEV — это
`console.error`.

**Граница доверия: `<Dynamic component="…">`.** Строковый `component` — это имя тега, а имя тега — ключ, а не
значение, поэтому политика атрибутов тут не поможет: по имени достижимы `style`, `base`, `meta`, `link`, `iframe`,
`object` и `embed`. Имя должно приходить от автора, но не из контента (сообщения, разметка ботов). Имя проверяется
(`/^[a-zA-Z][a-zA-Z0-9-]*$/`, иное ничего не рендерит и пишет DEV-ошибку), а `script` создаётся инертным (клон из
разобранного шаблона, его текст не выполняется); остальной allow-list остаётся за вами.

**Вне политики.** Политика охраняет *значения* атрибутов. Явные приёмники и выбор ключей не проверяются:
`innerHTML=`, `prop:*` (в том числе скомпилированные `prop:href` и `prop:srcdoc`), `setProperty`, *ключи* spread-объекта
(`{...bag}` может назвать `innerHTML`, `prop:*`, `use:*`), строковый `component` у `<Dynamic>` и `<script src>` с
недоверенным URL (фильтр схем тут бессилен, помогает CSP `script-src`). Держите их входы под своим контролем.
`<iframe srcdoc=…>` отклоняется и не типизирован; осознанная запись — `prop:srcdoc`.

## Стор

`frameact/store` — дерево простых объектов, свойства которого лениво становятся сигналами при первом отслеживаемом
чтении. `state.chats[id].title` подписывает ровно на этот путь; `setState('chats', id, 'title', t)` пишет в сырой
объект на месте и будит только этот лист: из тысячи строк пересчитывается одна, ничего не копируется, идентичность
(прокси, строки `For`) сохраняется. Данные с сервера вливаются диффом по ключу (`reconcile`), драфты — через `produce`,
слияние только явное (`merge()`), значение по пути заменяет, `undefined` удаляет ключ. Экшены — обычные типизированные
функции (`defineActions`); вложенный вызов выполняется после текущего, `afterActions(cb)` — после каскада.

Кадровые эффекты над стором внутри поддерева с тяжёлой анимацией *паркуются по причине*: эффект ждёт, только пока
записи в стор — единственная причина его грязности. Локальный сигнал или чтение через `live()` запускают его сразу,
и он читает текущий стор. Обработчик события, который пишет в стор, оставляет эффект запаркованным (сам обработчик и
императивные чтения видят текущее состояние, представление догоняет по окончании анимации): ни одно вычисление не
видит два момента стора. Логика на tickEnd не
паркуется, контролируемые инпуты (`use:value` / `use:checked`) не ждут никогда, `ungated(() => setState(…))` обходит
гейт на записи.

```ts
const [state, setState] = createStore(INITIAL_STATE);
setState('chats', id, 'unread', (n) => n + 1);
setState('messages', chatId, reconcile(chunk)); // иммутабельные данные с сервера, сопоставление по `id`
<For each={state.messages[chatId]}>{(m) => <Message m={m} />}</For>
```

## Вдохновение и благодарности

- **[teact](https://github.com/Ajaxy/teact)** Александра Зинчука — отсюда дисциплина кадра, fasterdom,
  stricterdom и гейтинг тяжёлых анимаций. На teact работают Telegram Web A (Telegram Air) и MyTonWallet.
  Статья, в которой объясняется идея:
  **[Fasterdom: Optimized Browser Rendering](https://ajaxy.github.io/teact/Fasterdom-Optimized-Browser-Rendering/)** —
  почему измерение сразу после мутации вызывает reflow и как `requestMeasure`, `requestMutation`,
  `requestNextMutation` и `requestForcedReflow` делят кадр на фазы.
- **[Telegram Web A](https://github.com/Ajaxy/telegram-tt)** — эталонная нагрузка: длинные списки, перестановка
  через CSS-трансформации, тяжёлые переходы, задержка ввода на мобильных.
- **[maverick-js/signals](https://github.com/maverick-js/signals)** Рахима Алвера — реактивный граф
  (вендорен и доработан), построенный на алгоритме Reactively.
- **[SolidJS](https://github.com/solidjs/solid)** и **[dom-expressions](https://github.com/ryansolid/dom-expressions)**
  Райана Карниато — модель компонентов, JSX-компилятор и устройство DOM-рантайма.

Сторонний код распространяется по MIT (udomdiff — ISC), авторство указано в каждом адаптированном файле.
Фикстуры компилятора в `test/dom/fixtures` вендорены дословно из solidjs/solid и вместо заголовков в файлах
сопровождаются файлом `SOURCE`.

## Дорожная карта

| План | Что входит | Статус |
|---|---|---|
| 1 · core | сигналы, двухфазные эффекты, кадровые очереди, гейтинг анимаций, `mapArray`, context | ✅ готово — [PR #1](https://github.com/denislibs/frameact/pull/1) |
| 2 · dom | рантайм для JSX-компилятора, `For`/`Show`/`Switch`, контролируемые инпуты, списки с ручным порядком, Vite-плагин | ✅ готово |
| 3 · store | стор-дерево сигналов: подписки на листья, запись по пути на месте, `reconcile`, парковка по причине на время анимаций, типизированные экшены | ✅ готово |
| 4 · stricterdom | dev-проверки фаз с атрибуцией до эффекта | ⏳ |
| 5 · benchmark | teact vs Solid 2.0 vs frameact на сценариях мессенджера (Chromium + WebKit, CPU ×4) | ⏳ |

Дизайн: [`docs/superpowers/specs/2026-10-11-frameact-design.md`](docs/superpowers/specs/2026-10-11-frameact-design.md) ·
планы: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Разработка

Нужны Node ≥ 22.12 и pnpm.

```bash
pnpm install
pnpm check     # oxlint + TypeScript 7 (tsc) + vitest
```

Тулчейн: TypeScript 7 (нативный), Vite 8 / Vitest 5 + jsdom, oxlint.

## Лицензия

[MIT](LICENSE). Вендоренный и адаптированный сторонний код (maverick-js/signals, teact, dom-expressions, solidjs/solid — части
web-клиента и фикстуры компилятора) — тоже MIT, udomdiff — ISC, см. [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
