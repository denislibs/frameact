import { createSignal } from '../../src/index';
import { mergeProps, splitProps } from '../../src/dom/props';

it('splits by key lists plus the rest; values stay lazy getters onto the source (reads are live, not copied)', () => {
  const [cls, setCls] = createSignal('a');
  const props = { get class() { return cls(); }, id: 'x', onClick: () => 1, title: 't' };
  const [local, events, rest] = splitProps(props, ['class', 'id'], ['onClick']);
  expect(Object.keys(local)).toEqual(['class', 'id']);
  expect(Object.keys(events)).toEqual(['onClick']);
  expect(Object.keys(rest)).toEqual(['title']);
  expect(local.class).toBe('a');
  setCls('b');
  expect(local.class).toBe('b'); // the getter reads through
  expect(events.onClick()).toBe(1);
  expect(rest.title).toBe('t');
  expect('class' in rest).toBe(false);
});

it('a key listed twice goes to the first list; keys absent from props are skipped; only own enumerable keys are split', () => {
  const proto = { inherited: 1 };
  const props = Object.create(proto) as { own: number; inherited: number };
  props.own = 2;
  const [a, b, rest] = splitProps(props as any, ['own', 'missing'], ['own']);
  expect(Object.keys(a)).toEqual(['own']);
  expect(Object.keys(b)).toEqual([]);
  expect(Object.keys(rest)).toEqual([]);
});

it('works over a mergeProps result (keys as of the call)', () => {
  const merged = mergeProps({ a: 1, b: 2 }, { c: 3 });
  const [ab, rest] = splitProps(merged, ['a', 'b']);
  expect({ ...ab }).toEqual({ a: 1, b: 2 });
  expect({ ...rest }).toEqual({ c: 3 });
});

it('is linear in the number of keys (a bag of data-chosen keys must not stall the main thread)', () => {
  const props: Record<string, number> = {};
  for (let i = 0; i < 50_000; i++) props[`k${i}`] = i;
  const start = performance.now();
  const [picked, rest] = splitProps(props, ['k1', 'k2']);
  const elapsed = performance.now() - start;
  expect(Object.keys(picked)).toEqual(['k1', 'k2']);
  expect(Object.keys(rest)).toHaveLength(49_998);
  expect(elapsed).toBeLessThan(250); // quadratic `includes`: ~1.2 s here
});

it('__proto__ as a data key stays an own key of the rest and never reaches a prototype', () => {
  const props = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>;
  const [a, rest] = splitProps(props, ['a']);
  expect(a.a).toBe(1);
  expect(Object.keys(rest)).toEqual(['__proto__']);
  expect(Object.getPrototypeOf(rest)).toBe(Object.prototype);
  expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
});
