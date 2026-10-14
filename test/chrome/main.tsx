// The headless-Chrome lane (run by test/chrome/run.mjs): what jsdom cannot check — real layout
// values, `innerText` / `elementFromPoint` / `scrollingElement` / `visualViewport`, the real
// MutationObserver and rAF microtask ordering, `isContentEditable`. Each scenario records the
// violations stricterdom reported; the page publishes the results in `data-result` on <html>.
import {
  createEffect, createMeasureEffect, createMutationEffect, createRoot, createSignal, flushSync, requestForcedReflow, requestMeasure,
  requestMutation,
} from 'frameact';
import { createComponent, Portal, render } from 'frameact/dom';
import {
  enableStrict, forceMeasure, forceMutation, getRunStats, IGNORE_SUBTREE_ATTR, setHandler, type StrictViolationError,
} from 'frameact/stricterdom';

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
let violations: StrictViolationError[] = [];
const app = document.getElementById('app')!;

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/**
 * One frame pass plus a macrotask, so the pass's microtasks (phases, observer callbacks) have run.
 * Headless Chrome under `--dump-dom` may never paint, so rAF may never fire: fasterdom then runs the
 * pass from its 35 ms timeout fallback, and this helper waits for whichever comes first.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 80);
  });
}

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function scenario(name: string, run: () => Promise<string[]> | string[]) {
  violations = [];
  try {
    const expected = await run();
    await nextFrame();
    const got = violations.map(summary);
    check(name, JSON.stringify(got) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  } catch (error) {
    check(name, false, `threw ${String(error)}`);
  }
}

function Panel(props: { probe: () => number }) {
  const [pad, setPad] = createSignal(0);
  let box!: HTMLDivElement;
  const view = <div ref={(el) => { box = el; }} class="box" style={{ 'padding-top': `${props.probe() + pad()}px` }} />;
  createMeasureEffect(() => props.probe(), () => { setPad(box.offsetHeight > 0 ? 1 : 0); }); // measure phase: allowed
  return view;
}

const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value.slice(-1) }));
};
const fired = (el: Element, name: string) => el.dispatchEvent(new Event(name, { bubbles: true }));
const letters = (v: string) => /^[a-z]*$/.test(v);

const exerciseControls = (root: ParentNode) => {
  const t = root.querySelector<HTMLInputElement>('.t')!;
  const a = root.querySelector<HTMLTextAreaElement>('.a')!;
  const s = root.querySelector<HTMLSelectElement>('.s')!;
  const c = root.querySelector<HTMLInputElement>('.c')!;
  type(t, 'ab1');
  type(a, 'ab1');
  s.value = 'c';
  fired(s, 'input');
  c.checked = true;
  fired(c, 'change');
  c.checked = false;
  fired(c, 'change');
  return [t.value, a.value, s.value, c.checked];
};

async function main() {
  enableStrict();
  setHandler((error) => { violations.push(error); });

  // 1. a layout read inside a compiled binding, in the mutate phase, with real layout behind it
  await scenario('measure-in-mutate', async () => {
    const [n, setN] = createSignal(0);
    let box!: HTMLElement;
    const dispose = render(() => createComponent(Panel, { probe: () => (n() === 0 ? 0 : (box.offsetHeight > 0 ? 1 : -1)) }), app);
    box = app.querySelector('.box')!;
    await nextFrame(); // the measure effect saw real layout (48px) and added 1px of padding
    setN(1); // the probe, read by the style binding in the mutate phase, reads layout: +1px and one violation
    await nextFrame();
    const height = box.offsetHeight; // 48 + 1 (measure effect) + 1 (probe)
    dispose();
    await nextFrame();
    return height === 50 ? ['measure:offsetHeight:mutate:Panel > div.style:padding-top'] : [`layout was ${height}`];
  });

  // 2. the Chrome-only layout causes
  await scenario('chrome-only-causes', () => {
    const el = document.createElement('div');
    el.textContent = 'x';
    forceMutation(() => app.appendChild(el), app);
    requestMutation(() => {
      void el.innerText;
      void document.elementFromPoint(1, 1);
      void document.scrollingElement;
      void visualViewport!.height;
    });
    return [
      'measure:innerText:mutate:-', 'measure:elementFromPoint:mutate:-', 'measure:scrollingElement:mutate:-', 'measure:height:mutate:-',
    ];
  });

  // 3. real rAF pass: a write in a measure task is caught; writes in the mutate task are not
  await scenario('raf-phases', () => {
    const el = document.createElement('div');
    forceMutation(() => app.appendChild(el), app);
    requestMeasure(() => { el.className = 'bad'; });
    requestMutation(() => { el.className = 'good'; el.appendChild(document.createElement('i')); });
    return ['mutation:class:measure:-'];
  });

  // 3b. the mutation a forced-reflow task returns runs in the forced-reflow mutate phase, two frames in a row
  // (client report: suspected attribution to the measure phase); a write in its measure half is caught
  await scenario('forced-reflow-mutation', async () => {
    const probe = document.createElement('div');
    probe.className = 'box';
    let measured = 0;
    for (let i = 0; i < 2; i++) {
      requestMutation(() => { app.appendChild(probe); });
      requestForcedReflow(() => {
        measured += probe.offsetHeight;
        return () => { probe.remove(); };
      });
      await nextFrame();
    }
    requestMutation(() => { app.appendChild(probe); });
    requestForcedReflow(() => {
      probe.title = 'bad';
      return () => { probe.remove(); };
    });
    return measured === 96 ? ['mutation:title:measure:-'] : [`measured ${measured}`]; // 2 frames × the 48 px `.box` of index.html: the reflow read saw the attached node
  });

  // 4. an event handler writing the DOM directly, through the real observer
  await scenario('event-handler-write', () => {
    const button = document.createElement('button');
    button.addEventListener('click', () => { button.classList.add('clicked'); });
    forceMutation(() => app.appendChild(button), app);
    button.click();
    return ['mutation:class:measure:-'];
  });

  // 5. forceMeasure in a mutate task reads real layout; a write inside its window is caught
  await scenario('forceMeasure', () => {
    const el = document.createElement('div');
    el.className = 'box';
    forceMutation(() => app.appendChild(el), app);
    let read = -1;
    requestMutation(() => {
      read = forceMeasure(() => el.offsetHeight);
      forceMeasure(() => { el.title = 'inside'; });
    });
    flushSync(); // from the event-handler level: allowed
    return read === 48 ? ['mutation:title:measure:-'] : [`read ${read}`];
  });

  // 6. the exceptions with the real DOM: isContentEditable, details[open], data-*, the ignore attribute
  await scenario('exceptions', async () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    const details = document.createElement('details');
    const ignored = document.createElement('div');
    ignored.setAttribute(IGNORE_SUBTREE_ATTR, '');
    forceMutation(() => { app.append(editor, details, ignored); }, app);
    await nextFrame();
    editor.appendChild(document.createTextNode('typed')); // childList inside an editable host
    details.open = true;
    app.dataset.state = 'open';
    ignored.appendChild(document.createElement('p'));
    ignored.firstElementChild!.className = 'x';
    editor.setAttribute('class', 'focused'); // an attribute on the editable host is still a violation
    return ['mutation:class:measure:-'];
  });

  // 7. selectionStart in the mutate phase
  await scenario('selectionStart', () => {
    const input = document.createElement('input');
    forceMutation(() => app.appendChild(input), app);
    requestMutation(() => { void input.selectionStart; });
    return ['measure:selectionStart:mutate:-'];
  });

  // 8. render + Portal + flushSync from the event-handler level: a clean app produces nothing
  await scenario('render-portal-flushSync', async () => {
    const [n, setN] = createSignal(0);
    const dispose = render(() => {
      const span = document.createElement('span');
      createMutationEffect(() => n(), (v) => { span.textContent = String(v); span.className = `n${v}`; });
      return [span, createComponent(Portal, { get children() { return document.createElement('i'); } })];
    }, app);
    await nextFrame();
    setN(1);
    flushSync();
    const committed = app.querySelector('span')!.className === 'n1';
    await nextFrame();
    dispose();
    await nextFrame();
    const stats = getRunStats().find((s) => s.path === 'mutation');
    return committed && stats !== undefined && stats.runs >= 1 ? [] : [`committed=${committed} stats=${JSON.stringify(stats)}`];
  });

  // 9. a handler writes a signal, then the DOM: in a browser the tickEnd drain runs BEFORE the observer
  //    callback — the pending record must not be attributed to the tickEnd effect that applies first
  await scenario('handler-write-before-tickEnd', async () => {
    const [n, setN] = createSignal(0);
    const button = document.createElement('button');
    forceMutation(() => app.appendChild(button), app);
    const dispose = createRoot((d) => {
      createEffect(() => n(), () => {}, undefined, { name: 'logic' });
      return d;
    });
    button.addEventListener('click', () => { setN(n() + 1); button.classList.add('pressed'); });
    await nextFrame(); // the first apply is done and no observer microtask is queued any more
    button.click();
    await nextFrame();
    dispose();
    return ['mutation:class:measure:-'];
  });

  // 10. controlled inputs (compiled `use:value` / `use:checked`): a template clone is bound while it is still
  //     owned by the template's inert document (cloneNode), so the revert listeners must not land there. Real
  //     Chromium: main document and an iframe, each control kind, no stricterdom violation from the revert.
  await scenario('controlled-inputs-live-document', async () => {
    let inertAtBind = false;
    const Form = () => {
      const [text, setText] = createSignal('ab');
      const [area, setArea] = createSignal('ab');
      const [pick, setPick] = createSignal('a');
      const [on, setOn] = createSignal(false);
      return (
        <div>
          <input ref={(el) => { inertAtBind = el.ownerDocument !== document; }} class="t" use:value={text} onInput={(e) => letters(e.currentTarget.value) && setText(e.currentTarget.value)} />
          <textarea class="a" use:value={area} onInput={(e) => letters(e.currentTarget.value) && setArea(e.currentTarget.value)} />
          <select class="s" use:value={pick} onInput={(e) => e.currentTarget.value !== 'c' && setPick(e.currentTarget.value)}>
            <option value="a">a</option><option value="b">b</option><option value="c">c</option>
          </select>
          <input class="c" type="checkbox" use:checked={on} onChange={(e) => e.currentTarget.checked && setOn(true)} />
        </div>
      );
    };
    const want = JSON.stringify(['ab', 'ab', 'a', true]);
    const mainHost = document.createElement('div');
    forceMutation(() => app.appendChild(mainHost), app);
    const disposeMain = render(() => createComponent(Form, {}), mainHost);
    const gotMain = JSON.stringify(exerciseControls(mainHost));
    const frame = document.createElement('iframe');
    forceMutation(() => app.appendChild(frame), app);
    const inner = frame.contentDocument!;
    const host = inner.createElement('div');
    inner.body.appendChild(host);
    const disposeFrame = render(() => createComponent(Form, {}), host);
    await Promise.resolve(); // the listeners of a document other than the app's are installed after the render inserted the clone
    const gotFrame = JSON.stringify(exerciseControls(host));
    await nextFrame();
    disposeMain();
    disposeFrame();
    forceMutation(() => { frame.remove(); mainHost.remove(); }, app);
    check('controlled-inputs-live-document: premise', inertAtBind, `inertAtBind=${inertAtBind} main=${gotMain} iframe=${gotFrame}`);
    return gotMain === want && gotFrame === want ? [] : [`main=${gotMain} iframe=${gotFrame} want=${want}`];
  });

  document.documentElement.dataset.result = JSON.stringify(results);
}

main().catch((error: unknown) => {
  results.push({ name: 'main', ok: false, detail: String(error) });
  document.documentElement.dataset.result = JSON.stringify(results);
});
