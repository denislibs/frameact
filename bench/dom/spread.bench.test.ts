// 1000 elements, each `spread(el, () => bag)` with 10 props; one signal (`selected`) feeds every
// bag and is toggled. Cost per toggle = signal write + flushSync over 1000 spread effects (jsdom).
import { createRoot, createSignal, flushSync } from '../../src/index';
import { spread } from '../../src/dom/props';

const N = 1000;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

it('spread: toggle one prop on 1000 elements', () => {
  const [selected, setSelected] = createSignal(false);
  const onClick = () => {};
  createRoot(() => {
    for (let i = 0; i < N; i++) {
      const el = document.createElement('li');
      spread(
        el,
        () => ({
          id: `row-${i}`,
          title: `title ${i}`,
          class: ['row', selected() && 'selected'],
          style: { color: 'red' },
          'data-index': i,
          'aria-label': `row ${i}`,
          tabIndex: 0,
          hidden: false,
          onClick,
          role: 'listitem',
        }),
        true,
      );
    }
  });
  flushSync();
  let on = false;
  const toggle = () => {
    on = !on;
    setSelected(on);
    flushSync();
  };
  for (let k = 0; k < 20; k++) toggle();
  const batches: number[] = [];
  for (let b = 0; b < 9; b++) {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) toggle();
    batches.push((performance.now() - t0) / 20); // ms per toggle (1000 elements)
  }
  process.stdout.write(`BENCH spread-toggle ${median(batches).toFixed(2)} ms/toggle (median of 9 x 20, ${N} elements, 10 props)\n`);
});
