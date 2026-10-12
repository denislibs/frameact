import { createSignal, flushSync } from 'frameact';
import { For, render, Show } from 'frameact/dom';
import { clearDelegatedEvents } from '../../src/dom/events';

afterEach(() => {
  clearDelegatedEvents();
  document.body.textContent = '';
});

function Counter(props: { start: number }) {
  const [n, setN] = createSignal(props.start);
  return (
    <button class={{ big: n() > 1 }} onClick={() => setN(n() + 1)}>
      {n()}
      <Show when={n() > 1}>!</Show>
    </button>
  );
}

it('TSX compiled by frameact/vite renders and updates through the real runtime', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const items = ['a', 'b'];
  const dispose = render(
    () => (
      <>
        <Counter start={1} />
        <ul>
          <For each={items}>{(item) => <li>{item}</li>}</For>
        </ul>
      </>
    ),
    el,
  );
  const button = el.querySelector('button')!;
  expect(button.textContent).toBe('1');
  expect(el.querySelectorAll('li').length).toBe(2);
  button.click();
  flushSync();
  expect(button.textContent).toBe('2!');
  expect(button.classList.contains('big')).toBe(true);
  dispose();
  expect(el.innerHTML).toBe('');
});
