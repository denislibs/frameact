import { createSignal } from 'frameact';
import { For, render } from 'frameact/dom';

const [rows, setRows] = createSignal([{ id: 1 }, { id: 2 }]);
const [selected, setSelected] = createSignal(1);

render(
  () => (
    <ul onClick={() => setRows(rows().toReversed())}>
      <For each={rows()}>{(row) => <li class={selected() === row.id ? 'on' : ''} onClick={() => setSelected(row.id)}>{row.id}</li>}</For>
    </ul>
  ),
  document.body,
);
