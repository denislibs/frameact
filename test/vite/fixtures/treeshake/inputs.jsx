import { createSignal } from 'frameact';
import { render } from 'frameact/dom';

const [text, setText] = createSignal('');

render(() => <input use:value={text} onInput={(e) => setText(e.currentTarget.value)} />, document.body);
