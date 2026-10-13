import { createSignal } from 'frameact';
import { ManualFor, render } from 'frameact/dom';

const [rows, setRows] = createSignal([{ id: 1 }, { id: 2 }]);

render(
  () => (
    <ul onClick={() => setRows(rows().toReversed())}>
      <ManualFor each={rows()} orderKey={(row) => row.id}>{(row) => <li>{row.id}</li>}</ManualFor>
    </ul>
  ),
  document.body,
);
