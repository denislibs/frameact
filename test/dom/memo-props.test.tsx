// The compiler wraps a conditional prop expression in `memo(() => !!cond)()` inside the prop getter
// (client report: `error={key && lang(key)}`, `size={big ? A : B}`). The getter runs wherever the prop is
// read: a child's effect apply, onMount, an event handler — contexts with no owner.
import { createEffect, createSignal, flushSync, onMount, requestMutation } from 'frameact';
import { render } from 'frameact/dom';
import { useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

const lang = (key: string) => `L(${key})`;

function Child(props: { error: string | false; size: 1 | 2; onLog: (entry: string) => void }) {
  const [tick, setTick] = createSignal(0);
  createEffect(
    () => tick(),
    () => {
      props.onLog(`apply:${props.error}:${props.size}`);
    },
  );
  onMount(() => {
    props.onLog(`mount:${props.error}:${props.size}`);
    requestMutation(() => props.onLog(`task:${props.error}:${props.size}`));
  });
  return (
    <button
      onClick={() => {
        props.onLog(`click:${props.error}:${props.size}`);
        setTick(tick() + 1);
      }}
    />
  );
}

it('a prop the compiler memoizes can be read from an apply, onMount, a frame task and a handler', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const [key, setKey] = createSignal<string | false>('k');
  const [big, setBig] = createSignal(false);
  const log: string[] = [];
  const dispose = render(
    () => <Child error={key() && lang(key() as string)} size={big() ? 1 : 2} onLog={(e) => log.push(e)} />,
    root,
  );
  await flushMicrotasks(); // tickEnd: the effect's first apply
  await frame(); // measure: onMount; mutate: the task
  expect(log).toEqual(['apply:L(k):2', 'mount:L(k):2', 'task:L(k):2']);
  log.length = 0;
  setKey(false);
  setBig(true);
  root.querySelector('button')!.click(); // handler reads the props fresh, then dirties the effect
  flushSync();
  await flushMicrotasks();
  expect(log).toEqual(['click:false:1', 'apply:false:1']);
  dispose();
});
