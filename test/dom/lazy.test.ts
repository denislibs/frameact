import { createRoot, createSignal, onError } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { lazy } from '../../src/dom/lazy';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const Hello = (props: { name: string }) => {
  const b = document.createElement('b');
  insert(b, () => `hi ${props.name}`);
  return b;
};

it('renders the placeholder until the module resolves, then the component with live props; the module is loaded once', async () => {
  const root = container();
  const d = deferred<{ default: typeof Hello }>();
  const loader = vi.fn(() => d.promise);
  const LazyHello = lazy(loader, { placeholder: () => document.createTextNode('…') });
  const [name, setName] = createSignal('a');
  createRoot(() => insert(root, createComponent(LazyHello, { get name() { return name(); } })));
  expect(root.textContent).toBe('…');
  expect(loader).toHaveBeenCalledTimes(1);
  d.resolve({ default: Hello });
  await flushMicrotasks();
  await frame();
  expect(root.innerHTML).toBe('<b>hi a</b>');
  setName('b');
  await frame();
  expect(root.innerHTML).toBe('<b>hi b</b>');
  // a second instance renders synchronously from the cache
  const root2 = container();
  createRoot(() => insert(root2, createComponent(LazyHello, { name: 'c' })));
  expect(root2.innerHTML).toBe('<b>hi c</b>');
  expect(loader).toHaveBeenCalledTimes(1);
});

it('preload() loads ahead of the first render; without a placeholder nothing is rendered while loading', async () => {
  const d = deferred<{ default: typeof Hello }>();
  const LazyHello = lazy(() => d.promise);
  const p = LazyHello.preload();
  d.resolve({ default: Hello });
  expect(await p).toBe(Hello);
  const root = container();
  createRoot(() => insert(root, createComponent(LazyHello, { name: 'x' })));
  expect(root.innerHTML).toBe('<b>hi x</b>');

  const never = lazy(() => new Promise<{ default: typeof Hello }>(() => {}));
  const empty = container();
  createRoot(() => insert(empty, createComponent(never, { name: 'y' })));
  expect(empty.innerHTML).toBe('');
});

it('a failed load goes to the owner\'s onError handlers (else the console), keeps the placeholder, and the next instance retries', async () => {
  const d1 = deferred<{ default: typeof Hello }>();
  const d2 = deferred<{ default: typeof Hello }>();
  let calls = 0;
  const LazyHello = lazy(() => (++calls === 1 ? d1.promise : d2.promise));
  const errors: unknown[] = [];
  const root = container();
  createRoot(() => {
    onError((e) => errors.push(e));
    insert(root, createComponent(LazyHello, { name: 'a' }));
  });
  d1.reject(new Error('offline'));
  await flushMicrotasks();
  expect(errors.map((e) => (e as Error).message)).toEqual(['offline']);
  expect(root.innerHTML).toBe('');
  const root2 = container();
  createRoot(() => insert(root2, createComponent(LazyHello, { name: 'b' })));
  expect(calls).toBe(2);
  d2.resolve({ default: Hello });
  await flushMicrotasks();
  await frame();
  expect(root2.innerHTML).toBe('<b>hi b</b>');

  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Failing = lazy(() => Promise.reject<{ default: typeof Hello }>(new Error('boom')));
  createRoot(() => insert(container(), createComponent(Failing, { name: 'z' })));
  await flushMicrotasks();
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0][0])).toContain('lazy');
});

it('a loader that throws synchronously is a failed load: it reaches onError and the next instance retries', async () => {
  let calls = 0;
  const LazyHello = lazy((): Promise<{ default: typeof Hello }> => {
    if (++calls === 1) throw new Error('sync boom');
    return Promise.resolve({ default: Hello });
  });
  const errors: unknown[] = [];
  const root = container();
  createRoot(() => {
    onError((e) => errors.push(e));
    insert(root, createComponent(LazyHello, { name: 'a' })); // must not throw out of the component
  });
  await flushMicrotasks();
  expect(errors.map((e) => (e as Error).message)).toEqual(['sync boom']);
  expect(root.innerHTML).toBe('');
  const root2 = container();
  createRoot(() => insert(root2, createComponent(LazyHello, { name: 'b' })));
  await flushMicrotasks();
  await frame();
  expect(root2.innerHTML).toBe('<b>hi b</b>');
  await expect(lazy(() => { throw new Error('x'); }).preload()).rejects.toThrow('x'); // preload() reports it as a rejection
});
