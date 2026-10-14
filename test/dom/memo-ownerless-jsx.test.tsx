// JSX evaluated with no owner (a handler, a task, module level) hoists `var _c$ = memo(() => !!c())` there and
// reads it later from the tracked `insert` effect: the truthiness cut-off must survive (review: a branch mounted
// 3 times instead of 1). Such JSX is never disposed, as on main; the cut-off must not regress on top of that.
import { createSignal, flushSync } from 'frameact';

it('a conditional child of ownerless JSX remounts only when the truthiness changes', () => {
  const [c, setC] = createSignal(1);
  let mounts = 0;
  const B = () => {
    mounts++;
    return <b>B</b>;
  };
  const el = (<div>{c() ? <B /> : null}</div>) as HTMLDivElement; // no owner: evaluated at test level
  expect(el.innerHTML).toBe('<b>B</b>');
  setC(2);
  flushSync();
  setC(3);
  flushSync();
  expect(mounts).toBe(1);
  setC(0);
  flushSync();
  expect(el.innerHTML).toBe('');
  setC(4);
  flushSync();
  expect(mounts).toBe(2);
});
