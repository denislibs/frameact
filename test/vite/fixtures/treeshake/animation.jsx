import { beginHeavyAnimation, createSignal } from 'frameact';
import { render } from 'frameact/dom';

const [n, setN] = createSignal(0);

render(
  () => (
    <button
      onClick={() => {
        beginHeavyAnimation(100, true);
        setN(n() + 1);
      }}
    >
      {n()}
    </button>
  ),
  document.body,
);
