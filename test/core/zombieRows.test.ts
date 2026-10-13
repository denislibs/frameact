// Zombie rows (plan-2 defect, found by the store prototype): a mapArray row that looks its entity up
// elsewhere must never run after the entity is gone but before the list removed it. The row's run
// pulls a dirty map memo first (effects.ts ancestor rule + Scope._mapMemo), in every keyed mode and
// through For's frame effects as well as tickEnd effects.
import { createEffect, createRoot, createSignal, flushSync, mapArray, onCleanup } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { ManualFor } from '../../src/dom/manualFor';
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
    // the kept rows re-ran once each (chats changed) with the current data
    expect(titles.slice(3)).toHaveLength(2);
    expect(titles.slice(3)).toEqual(expect.arrayContaining(['1:a', '2:b']));
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

// The map pull WRITES the item/index nodes of the rows it keeps: it can dirty an effect between a row
// and the map scope, or an inner map memo (nested lists), that the ancestor walk saw clean. The run
// walks its chain again after pulling a map.
describe('map pull dirties what the walk saw clean', () => {
  type Row = { id: number; child: number | null };
  it('keyed: fn, a conditional subtree on item().child: the inner effect never reads the deleted entity', () => {
    const [list, setList] = createSignal<Row[]>([{ id: 1, child: 2 }]);
    const [ents, setEnts] = createSignal<Record<number, { t: string }>>({ 2: { t: 'x' } });
    const errors: unknown[] = [];
    const seen: string[] = [];
    createRoot(() => {
      const rows = mapArray(
        list,
        (item: () => Row) => {
          createEffect(
            () => {
              const c = item().child;
              if (c != null) {
                createEffect(
                  () => {
                    try {
                      const t = ents()[c].t;
                      seen.push(t);
                      return t;
                    } catch (e) {
                      errors.push(e);
                      return 'error';
                    }
                  },
                  () => {},
                );
              }
              return c;
            },
            () => {},
          );
          return item().id;
        },
        { keyed: (r: Row) => r.id },
      );
      createEffect(() => rows().join(), () => {});
    });
    flushSync();
    expect(seen).toEqual(['x']);
    setEnts({});
    setList([{ id: 1, child: null }]);
    flushSync();
    expect(errors).toEqual([]);
    expect(seen).toEqual(['x']);
  });

  const nestedModes: [string, Mode][] = [['outer keyed: false', false], ['outer keyed: fn', (g: any) => g.id]];
  it.each(nestedModes)('nested mapArray, %s: the inner row never reads the deleted entity', (_n, outerKeyed) => {
    type Group = { id: number; ids: number[] };
    const [groups, setGroups] = createSignal<Group[]>([{ id: 1, ids: [2, 1] }]);
    const [ents, setEnts] = createSignal<Record<number, { t: string }>>({ 1: { t: 'a' }, 2: { t: 'b' } });
    const errors: unknown[] = [];
    const seen: string[] = [];
    createRoot(() => {
      const outer = mapArray(
        groups,
        (g: any) => {
          const gg = typeof g === 'function' ? (g as () => Group) : () => g as Group;
          const inner = mapArray(
            () => gg().ids,
            (id: number) => {
              createEffect(
                () => {
                  try {
                    const t = `${id}:${ents()[id].t}`;
                    seen.push(t);
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
          );
          createEffect(() => inner().join(), () => {});
          return gg().id;
        },
        { keyed: outerKeyed } as any,
      );
      createEffect(() => outer().join(), () => {});
    });
    flushSync();
    expect(seen).toEqual(['2:b', '1:a']);
    setEnts({ 1: { t: 'a' } });
    setGroups([{ id: 1, ids: [1] }]);
    flushSync();
    expect(errors).toEqual([]);
    expect(seen.filter((t) => t.startsWith('2:'))).toEqual(['2:b']);
  });
});

it('a throwing map memo does not break its rows: they run with the current data, nothing is logged twice', () => {
  const [ids, setIds] = createSignal([1, 2]);
  const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
  const [boom, setBoom] = createSignal(false);
  const titles: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    createRoot(() => {
      const rows = mapArray(
        () => {
          const l = ids();
          if (boom()) throw new Error('boom');
          return l;
        },
        (id: number) => {
          createEffect(() => {
            const t = `${id}:${chats()[id]?.title}`;
            titles.push(t);
            return t;
          }, () => {});
          return id;
        },
      );
      createEffect(() => { try { return rows().join(); } catch { return 'err'; } }, () => {});
    });
    flushSync();
    setBoom(true);
    setChats({ 1: { title: 'A' }, 2: { title: 'B' } });
    flushSync();
    expect(titles.slice(2)).toHaveLength(2);
    expect(titles.slice(2)).toEqual(expect.arrayContaining(['1:A', '2:B']));
    expect(spy.mock.calls.length).toBe(0);
    setBoom(false);
    setIds([1]);
    flushSync();
    expect(titles.slice(4)).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it('a row under a dirty owner effect bails onto it (the map is not pulled by the row) and is disposed with it', () => {
  const [gen, setGen] = createSignal(0);
  const [ids, setIds] = createSignal([1, 2]);
  const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
  const errors: unknown[] = [];
  const titles: string[] = [];
  createRoot(() => {
    createEffect(
      () => {
        const g = gen();
        const rows = mapArray(ids, (id: number) => {
          createEffect(
            () => {
              try {
                const t = `${g}:${id}:${chats()[id].title}`;
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
        });
        createEffect(() => rows().join(), () => {});
        return g;
      },
      () => {},
    );
  });
  flushSync();
  expect(titles).toEqual(['0:1:a', '0:2:b']);
  setChats({ 1: { title: 'a' } });
  setIds([1]);
  setGen(1); // the owner effect is dirty: the rows bail onto it and die with the old map
  flushSync();
  expect(errors).toEqual([]);
  expect(titles).toEqual(['0:1:a', '0:2:b', '1:1:a']);
});

it('ManualFor: a row looking an entity up by id is disposed, not run, when both are deleted', async () => {
  const ul = container();
  const [ids, setIds] = createSignal([1, 2]);
  const [chats, setChats] = createSignal<Chats>({ 1: { title: 'a' }, 2: { title: 'b' } });
  const errors: unknown[] = [];
  const ForC = ManualFor as (props: any) => unknown;
  createRoot(() =>
    insert(
      ul,
      createComponent(ForC, {
        get each() { return ids(); },
        orderKey: (id: number) => id,
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

// Known limitation (spec §3.2): the re-walk after a map pull is bounded. A loop through nested lists
// (an inner mapper writes the outer list's source, so the list grows on every pass) is invisible to
// the per-effect loop counters; without the bound it would spin synchronously inside one runEffect.
it('a runaway loop through nested lists stops: the re-walk is bounded and a DEV error names the cause', () => {
  const [groups, setGroups] = createSignal<{ id: number; ids: number[] }[]>([{ id: 1, ids: [0] }]);
  const [kick, setKick] = createSignal(0);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let mapperCalls = 0;
  let armed = false;
  try {
    createRoot(() => {
      const outer = mapArray(
        groups,
        (g: () => { id: number; ids: number[] }) => {
          const inner = mapArray(
            () => g().ids,
            (id: number) => {
              mapperCalls++;
              // The test's own guard: the runaway stops by itself after 1000 passes, so a missing
              // bound fails the assertion below instead of hanging the suite.
              if (armed && mapperCalls < 1000) setGroups((gs) => [{ id: 1, ids: [...gs[0].ids, id + 1] }]);
              // One effect only (the first row's): the loop must not escape the per-effect counters
              // by spawning ever new effects.
              if (id === 0) createEffect(() => `${id}:${kick()}`, () => {});
              return id;
            },
          );
          inner(); // created eagerly; no effect reads the lists: only the rows' ancestor walk pulls them
          return g().id;
        },
        { keyed: false },
      );
      outer();
    });
    flushSync();
    mapperCalls = 0;
    armed = true;
    setKick(1);
    setGroups((gs) => [{ id: 1, ids: [...gs[0].ids, 100] }]);
    flushSync();
    expect(mapperCalls).toBeLessThan(100);
    expect(spy.mock.calls.some((c) => /map pulls/.test(String(c[0])))).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
