// Zombie rows (plan-2 defect, found by the store prototype): a mapArray row that looks its entity up
// elsewhere must never run after the entity is gone but before the list removed it. The row's run
// pulls a dirty map memo first (effects.ts ancestor rule + Scope._mapMemo), in every keyed mode and
// through For's frame effects as well as tickEnd effects.
import { createEffect, createRoot, createSignal, flushSync, mapArray, onCleanup } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

type Chats = Record<number, { title: string }>;
type Mode = true | false | ((id: number) => unknown);
const modes: [string, Mode][] = [['keyed: true', true], ['keyed: false', false], ['keyed: fn', (id) => id]];

function mount(ids: () => number[], chats: () => Chats, keyed: Mode) {
  const errors: unknown[] = [];
  const titles: string[] = [];
  const disposed: number[] = [];
  let mapRuns = 0;
  createRoot(() => {
    const rows = mapArray(
      () => {
        mapRuns++;
        return ids();
      },
      (item: number | (() => number)) => {
        const id = typeof item === 'function' ? item() : item;
        onCleanup(() => disposed.push(id));
        createEffect(
          () => {
            try {
              const t = `${id}:${chats()[id].title}`;
              titles.push(t);
              return t;
            } catch (e) {
              errors.push(e);
              return 'error';
            }
          },
          () => {},
        );
        return id;
      },
      { keyed },
    );
    createEffect(() => rows().join(), () => {});
  });
  flushSync();
  return { errors, titles, disposed, mapRuns: () => mapRuns };
}

describe.each(modes)('mapArray %s', (_name, keyed) => {
  it('deleting the entity before its id (worst order) never runs the removed row: its run pulls the dirty map memo and is disposed', () => {
    const [ids, setIds] = createSignal([1, 2]);
    const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
    const { errors, titles, disposed, mapRuns } = mount(ids, chats, keyed);
    expect(titles).toEqual(['1:a', '2:b']);
    setChats({ 1: { title: 'a' } }); // the entity first: row 2's effect is booked before the list's reader
    setIds([1]);
    flushSync();
    expect(errors).toEqual([]);
    expect(disposed).toEqual([2]);
    expect(titles).toEqual(['1:a', '2:b', '1:a']); // row 1 re-ran (chats changed); row 2 never ran stale
    expect(mapRuns()).toBe(2);
  });

  it('a clean map memo is not pulled: an entity edit re-runs its row only', () => {
    const [ids] = createSignal([1, 2]);
    const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
    const { errors, titles, mapRuns } = mount(ids, chats, keyed);
    setChats({ 1: { title: 'a' }, 2: { title: 'B' } });
    flushSync();
    expect(errors).toEqual([]);
    expect(titles).toEqual(['1:a', '2:b', '1:a', '2:B']);
    expect(mapRuns()).toBe(1);
  });

  it('a reorder plus an entity edit in one tick: the map recomputes once, kept rows run with the current list, no errors', () => {
    const [ids, setIds] = createSignal([1, 2, 3]);
    const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' }, 3: { title: 'c' } });
    const { errors, titles, disposed, mapRuns } = mount(ids, chats, keyed);
    setChats({ 1: { title: 'a' }, 2: { title: 'b' } }); // 3 is gone
    setIds([2, 1]);
    flushSync();
    expect(errors).toEqual([]);
    expect(disposed).toEqual([3]);
    expect(mapRuns()).toBe(2);
    expect(titles.filter((t) => t.startsWith('3:'))).toEqual(['3:c']);
  });
});

it('For (frame effects): a row text bound to entities()[id] is disposed before it would read a deleted entity', async () => {
  const ul = container();
  const [ids, setIds] = createSignal([1, 2]);
  const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
  const errors: unknown[] = [];
  const ForC = For as (props: any) => unknown;
  createRoot(() =>
    insert(
      ul,
      createComponent(ForC, {
        get each() { return ids(); },
        children: (id: number) => {
          const li = document.createElement('li');
          insert(li, () => {
            try {
              return chats()[id].title;
            } catch (e) {
              errors.push(e);
              return 'error';
            }
          });
          return li;
        },
      }),
    ),
  );
  expect(ul.textContent).toBe('ab');
  setChats({ 1: { title: 'A' } });
  setIds([1]);
  await frame();
  expect(errors).toEqual([]);
  expect(ul.textContent).toBe('A');
});
