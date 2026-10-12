import { addEvent, clearDelegatedEvents, delegateEvents, EVENT_KEY, setListener } from '../../src/dom/events';
import { useDomHarness, container } from '../helpers/dom';

useDomHarness();

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

it('delegated handlers run with the compiler keys, data tuples, simulated currentTarget, bubbling and cancelBubble', () => {
  const outer = container();
  const inner = document.createElement('button');
  outer.appendChild(inner);
  const log: string[] = [];
  addEvent(inner, 'click', [(data: number, e: Event) => log.push(`inner:${data}:${(e.currentTarget as Element).tagName}`), 42], true);
  addEvent(outer, 'click', (e: Event) => log.push(`outer:${(e.currentTarget as Element).tagName}`), true);
  expect((inner as any)[EVENT_KEY + 'click']).toBeTypeOf('function');
  expect((inner as any)[EVENT_KEY + 'clickData']).toBe(42);
  delegateEvents(['click']);
  delegateEvents(['click']); // idempotent
  click(inner);
  expect(log).toEqual(['inner:42:BUTTON', 'outer:DIV']);
  log.length = 0;
  addEvent(inner, 'click', (e: Event) => { log.push('stop'); e.stopPropagation(); }, true);
  click(inner);
  expect(log).toEqual(['stop']);
  (inner as HTMLButtonElement).disabled = true;
  log.length = 0;
  click(inner);
  expect(log).toEqual(['outer:DIV']);
});

it('clearDelegatedEvents detaches the document listeners', () => {
  const el = container();
  const handler = vi.fn();
  addEvent(el, 'click', handler, true);
  delegateEvents(['click']);
  clearDelegatedEvents();
  click(el);
  expect(handler).not.toHaveBeenCalled();
});

it('non-delegated addEvent attaches listeners (plain, tuple, listener object with options)', () => {
  const el = container();
  const log: string[] = [];
  addEvent(el, 'custom', () => log.push('plain'));
  addEvent(el, 'custom', [(data: string) => log.push(`tuple:${data}`), 'd']);
  addEvent(el, 'custom', { handleEvent: () => log.push('object'), once: true });
  el.dispatchEvent(new Event('custom'));
  el.dispatchEvent(new Event('custom'));
  expect(log).toEqual(['plain', 'tuple:d', 'object', 'plain', 'tuple:d']);
});

it('setListener (on:/oncapture:) replaces and removes', () => {
  const el = container();
  const a = vi.fn();
  const b = vi.fn();
  setListener(el, 'ping', a, false);
  el.dispatchEvent(new Event('ping'));
  setListener(el, 'ping', b, false);
  el.dispatchEvent(new Event('ping'));
  setListener(el, 'ping', null, false);
  el.dispatchEvent(new Event('ping'));
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  const order: string[] = [];
  const child = document.createElement('i');
  el.appendChild(child);
  setListener(el, 'ping', () => order.push('capture'), true);
  child.addEventListener('ping', () => order.push('target'));
  child.dispatchEvent(new Event('ping', { bubbles: true }));
  expect(order).toEqual(['capture', 'target']);
});
