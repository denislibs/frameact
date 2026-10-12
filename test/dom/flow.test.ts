import { createRoot, createSignal, onCleanup, onError } from '../../src/index';
import { insert, portalHostOf } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { mergeProps } from '../../src/dom/props';
import { Dynamic, Match, Portal, Show, Switch } from '../../src/dom/flow';
import { addEvent, delegateEvents } from '../../src/dom/events';
import { strictHooks } from '../../src/dom/strict';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

// The typed overloads (JSX use) are exercised in test/jsx/types.tsx; these tests build props by hand.
const ShowC = Show as (props: any) => unknown;
const MatchC = Match as (props: any) => unknown;

const el = (tag: string, text = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};

const Comp = (props: { title: string }) => el('i', props.title);

const Keys = (props: Record<string, unknown>) => {
  const s = el('s');
  insert(s, () => `${Object.keys(props).join(',')}|${'component' in props}|${String(props.extra)}`);
  return s;
};

function mount(target: HTMLElement, make: () => unknown) {
  return createRoot((dispose) => {
    insert(target, make());
    return dispose;
  });
}

describe('Show', () => {
  it('renders children or fallback; non-keyed keeps the child across truthy values; keyed recreates on identity change', async () => {
    const root = container();
    const [when, setWhen] = createSignal<{ n: number } | null>({ n: 1 });
    const made = vi.fn((item: () => { n: number }) => {
      const b = el('b');
      insert(b, () => String(item().n));
      return b;
    });
    mount(root, () => createComponent(ShowC, { get when() { return when(); }, get fallback() { return el('i', 'none'); }, children: made }));
    expect(root.innerHTML).toBe('<b>1</b>');
    setWhen({ n: 2 });
    await frame();
    expect(root.innerHTML).toBe('<b>2</b>');
    expect(made).toHaveBeenCalledTimes(1);
    setWhen(null);
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>');
    setWhen({ n: 3 });
    await frame();
    expect(root.innerHTML).toBe('<b>3</b>');
    expect(made).toHaveBeenCalledTimes(2);

    const keyedRoot = container();
    const keyedMade = vi.fn((item: { n: number }) => el('b', String(item.n)));
    mount(keyedRoot, () => createComponent(ShowC, { get when() { return when(); }, keyed: true, children: keyedMade }));
    expect(keyedRoot.innerHTML).toBe('<b>3</b>');
    setWhen({ n: 4 });
    await frame();
    expect(keyedRoot.innerHTML).toBe('<b>4</b>');
    expect(keyedMade).toHaveBeenCalledTimes(2);
  });

  it('plain children are returned as-is', () => {
    const root = container();
    const [when] = createSignal(true);
    mount(root, () => createComponent(ShowC, { get when() { return when(); }, get children() { return el('u', 'x'); } }));
    expect(root.innerHTML).toBe('<u>x</u>');
  });
});

describe('Switch/Match', () => {
  it('renders the first truthy Match, else the fallback; function children receive an accessor', async () => {
    const root = container();
    const [a, setA] = createSignal(false);
    const [b, setB] = createSignal<string | null>(null);
    mount(root, () =>
      createComponent(Switch, {
        get fallback() { return el('i', 'none'); },
        get children() {
          return [
            createComponent(MatchC, { get when() { return a(); }, get children() { return el('b', 'A'); } }),
            createComponent(MatchC, {
              get when() { return b(); },
              children: (v: () => string) => {
                const s = el('s');
                insert(s, v);
                return s;
              },
            }),
          ];
        },
      }),
    );
    expect(root.innerHTML).toBe('<i>none</i>');
    setB('bee');
    await frame();
    expect(root.innerHTML).toBe('<s>bee</s>');
    setB('buzz');
    await frame();
    expect(root.innerHTML).toBe('<s>buzz</s>');
    setA(true);
    await frame();
    expect(root.innerHTML).toBe('<b>A</b>');
    setA(false);
    setB(null);
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>');
  });
});

describe('keyed Match', () => {
  it('passes the value itself and recreates the branch when the identity changes', async () => {
    const root = container();
    const [v, setV] = createSignal<{ n: number } | null>({ n: 1 });
    const made = vi.fn((item: { n: number }) => el('b', String(item.n)));
    mount(root, () =>
      createComponent(Switch, {
        get fallback() { return el('i', 'none'); },
        get children() {
          return createComponent(MatchC, { get when() { return v(); }, keyed: true, children: made });
        },
      }),
    );
    expect(root.innerHTML).toBe('<b>1</b>');
    setV({ n: 2 });
    await frame();
    expect(root.innerHTML).toBe('<b>2</b>');
    expect(made).toHaveBeenCalledTimes(2);
    setV(null);
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>');
  });
});

describe('Dynamic', () => {
  it('renders a tag name with spread props or a component, and switches', async () => {
    const root = container();
    const [comp, setComp] = createSignal<string | typeof Comp | null>('b');
    const [title, setTitle] = createSignal('t');
    mount(root, () => createComponent(Dynamic, { get component() { return comp(); }, get title() { return title(); }, children: 'kid' }));
    expect(root.innerHTML).toBe('<b title="t">kid</b>');
    setTitle('t2');
    await frame();
    expect(root.innerHTML).toBe('<b title="t2">kid</b>');
    setComp(() => Comp);
    await frame();
    expect(root.innerHTML).toBe('<i>t2</i>');
    setComp(null);
    await frame();
    expect(root.innerHTML).toBe('');
  });

  it('keeps the same element on a prop change; a tag change disposes the old subtree and its binding', async () => {
    const root = container();
    const [comp, setComp] = createSignal<string | ((p: { title: string }) => unknown)>('b');
    const [title, setTitle] = createSignal('t');
    const disposed = vi.fn();
    const Cleaning = (props: { title: string }) => {
      onCleanup(disposed);
      return el('i', props.title);
    };
    mount(root, () => createComponent(Dynamic, { get component() { return comp(); }, get title() { return title(); } }));
    const first = root.firstElementChild!;
    setTitle('t2');
    await frame();
    expect(root.firstElementChild).toBe(first);
    expect(first.getAttribute('title')).toBe('t2');
    setComp('s');
    await frame();
    expect(root.innerHTML).toBe('<s title="t2"></s>');
    setTitle('t3');
    await frame();
    expect(first.getAttribute('title')).toBe('t2'); // the old element's spread effect is dead
    setComp(() => Cleaning);
    await frame();
    expect(root.innerHTML).toBe('<i>t3</i>');
    expect(disposed).not.toHaveBeenCalled();
    setComp('u');
    await frame();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toBe('<u title="t3"></u>');
  });

  it('props whose key set follows a function source (mergeProps): keys that appear later are applied, `component` never is', async () => {
    const root = container();
    const [attrs, setAttrs] = createSignal<Record<string, string>>({});
    mount(root, () => createComponent(Dynamic, mergeProps(() => attrs(), { component: 'b' })));
    expect(root.innerHTML).toBe('<b></b>');
    setAttrs({ title: 'a', id: 'x' });
    await frame();
    expect(root.innerHTML).toBe('<b title="a" id="x"></b>');
    setAttrs({ id: 'y' });
    await frame();
    expect(root.innerHTML).toBe('<b id="y"></b>');
  });

  it('a component sees the live key set without `component`', async () => {
    const root = container();
    const [attrs, setAttrs] = createSignal<Record<string, string>>({});
    mount(root, () => createComponent(Dynamic, mergeProps(() => attrs(), { component: Keys, a: '1' })));
    expect(root.innerHTML).toBe('<s>a|false|undefined</s>');
    setAttrs({ extra: 'e' });
    await frame();
    expect(root.innerHTML).toBe('<s>extra,a|false|e</s>');
  });

  it('creates SVG tags in the SVG namespace', () => {
    const root = container();
    mount(root, () => createComponent(Dynamic, { component: 'rect', width: '5' }));
    const rect = root.firstElementChild!;
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(rect.localName).toBe('rect');
    expect(rect.getAttribute('width')).toBe('5');
  });
});

describe('Portal', () => {
  it('renders into the mount, retargets delegated events to the logical parent, and cleans up on dispose', async () => {
    const logical = container();
    const mountEl = container();
    const clicks: string[] = [];
    addEvent(logical, 'click', () => clicks.push('logical'), true);
    delegateEvents(['click']);
    const [text, setText] = createSignal('p');
    const dispose = mount(logical, () =>
      createComponent(Portal, {
        mount: mountEl,
        get children() {
          const s = el('span');
          insert(s, text);
          return s;
        },
      }),
    );
    expect(mountEl.innerHTML).toBe('<span>p</span>');
    expect(logical.childNodes.length).toBe(1); // the tree marker
    setText('q');
    await frame();
    expect(mountEl.innerHTML).toBe('<span>q</span>');
    mountEl.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(clicks).toEqual(['logical']);
    dispose();
    await frame(); // DOM-writing cleanups land in the mutate phase
    expect(mountEl.innerHTML).toBe('');
  });

  it('defaults to document.body', () => {
    const logical = container();
    const dispose = mount(logical, () => createComponent(Portal, { get children() { return el('em', 'body'); } }));
    expect(document.body.querySelector('em')!.textContent).toBe('body');
    expect(logical.querySelector('em')).toBeNull();
    dispose();
  });

  it('re-renders into the new mount when `mount` changes and empties the old one', async () => {
    const logical = container();
    const first = container();
    const second = container();
    const [target, setTarget] = createSignal<Element>(first);
    const dispose = mount(logical, () =>
      createComponent(Portal, {
        get mount() { return target(); },
        get children() { return el('span', 'p'); },
      }),
    );
    expect(first.innerHTML).toBe('<span>p</span>');
    setTarget(second);
    await frame();
    expect(first.innerHTML).toBe('');
    expect(first.childNodes.length).toBe(0); // the markers are gone too
    expect(second.innerHTML).toBe('<span>p</span>');
    dispose();
    await frame();
    expect(second.innerHTML).toBe('');
    expect(second.childNodes.length).toBe(0);
  });

  it('a mount getter that re-runs with the same element, and a children recompute, keep the nodes and focus', async () => {
    const logical = container();
    const mountEl = container();
    const [tick, setTick] = createSignal(0);
    const span = el('span');
    const input = document.createElement('input');
    span.appendChild(input);
    mount(logical, () =>
      createComponent(Portal, {
        get mount() { tick(); return mountEl; },
        get children() { tick(); return span; },
      }),
    );
    input.focus();
    expect(document.activeElement).toBe(input);
    setTick(1);
    await frame();
    expect(mountEl.firstElementChild).toBe(span);
    expect(span.firstChild).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(mountEl.childNodes.length).toBe(3); // start marker, span, end marker
  });

  it('children changing in the same mount are reconciled; the markers stay exactly two', async () => {
    const logical = container();
    const mountEl = container();
    const [which, setWhich] = createSignal(0);
    const nodes = [el('b', 'a'), el('i', 'b')];
    const dispose = mount(logical, () =>
      createComponent(Portal, { mount: mountEl, get children() { return which() === 2 ? [nodes[0], nodes[1]] : nodes[which()]; } }),
    );
    expect(mountEl.innerHTML).toBe('<b>a</b>');
    setWhich(1);
    await frame();
    expect(mountEl.innerHTML).toBe('<i>b</i>');
    expect(mountEl.childNodes.length).toBe(3);
    setWhich(2);
    await frame();
    expect(mountEl.innerHTML).toBe('<b>a</b><i>b</i>');
    expect(mountEl.childNodes.length).toBe(4);
    dispose();
    await frame();
    expect(mountEl.childNodes.length).toBe(0);
  });

  it('a node handed from one portal to another is re-hosted by the portal that owns it now', async () => {
    const logical1 = container();
    const logical2 = container();
    const mount1 = container();
    const mount2 = container();
    const [which, setWhich] = createSignal(1);
    const shared = el('span');
    mount(logical1, () => createComponent(Portal, { mount: mount1, get children() { return which() === 1 ? shared : null; } }));
    mount(logical2, () => createComponent(Portal, { mount: mount2, get children() { return which() === 2 ? shared : null; } }));
    expect(portalHostOf(shared)).toBe(logical1);
    setWhich(2);
    await frame();
    expect(shared.parentNode).toBe(mount2);
    expect(portalHostOf(shared)).toBe(logical2);
    setWhich(1);
    await frame();
    expect(shared.parentNode).toBe(mount1);
    expect(portalHostOf(shared)).toBe(logical1);
  });

  it('the host is kept in a registry, not on the node; a delegated click reaches the logical parent handlers, not the mount ancestors', () => {
    const logical = container();
    const mountEl = container();
    const clicks: string[] = [];
    addEvent(logical, 'click', () => clicks.push('logical'), true);
    addEvent(mountEl, 'click', () => clicks.push('mount'), true);
    delegateEvents(['click']);
    const inner = el('span');
    addEvent(inner, 'click', () => clicks.push('inner'), true);
    mount(logical, () => createComponent(Portal, { mount: mountEl, children: inner }));
    expect(Object.getOwnPropertyNames(inner)).not.toContain('_$host'); // nothing is written onto the node
    expect(portalHostOf(inner)).toBe(logical);
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(clicks).toEqual(['inner', 'logical']);
  });

  it('a node moved out of the portal no longer reports the old host, and its events follow its real parent', () => {
    const logical = container();
    const mountEl = container();
    const elsewhere = container();
    const clicks: string[] = [];
    addEvent(logical, 'click', () => clicks.push('logical'), true);
    addEvent(elsewhere, 'click', () => clicks.push('elsewhere'), true);
    delegateEvents(['click']);
    const inner = el('span');
    mount(logical, () => createComponent(Portal, { mount: mountEl, children: inner }));
    expect(portalHostOf(inner)).toBe(logical);
    elsewhere.appendChild(inner);
    expect(portalHostOf(inner)).toBeNull();
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(clicks).toEqual(['elsewhere']);
    inner.remove();
    expect(portalHostOf(inner)).toBeNull();
  });

  it('attaching into a live mount goes through the forceMutation seam, at creation and on cleanup', async () => {
    const logical = container();
    const mountEl = container();
    const real = strictHooks.forceMutation;
    const targets: Node[] = [];
    let forced = false;
    strictHooks.forceMutation = (cb, target) => {
      targets.push(target);
      const prev = forced;
      forced = true;
      try {
        return cb();
      } finally {
        forced = prev;
      }
    };
    const unforced: string[] = [];
    for (const method of ['appendChild', 'insertBefore', 'removeChild'] as const) {
      const orig = mountEl[method].bind(mountEl) as (...args: unknown[]) => unknown;
      (mountEl as any)[method] = (...args: unknown[]) => {
        if (!forced) unforced.push(method);
        return orig(...args);
      };
    }
    try {
      const dispose = mount(logical, () => createComponent(Portal, { mount: mountEl, get children() { return el('span', 'p'); } }));
      expect(mountEl.innerHTML).toBe('<span>p</span>');
      expect(targets).toEqual([mountEl]);
      dispose();
      await frame();
      expect(mountEl.innerHTML).toBe('');
      expect(targets).toEqual([mountEl, mountEl]);
      expect(unforced).toEqual([]);
    } finally {
      strictHooks.forceMutation = real;
    }
  });
});

describe('conditions that throw', () => {
  it('Show: an error in `when` reaches the reader; recovering (even with the same truthiness) renders again', async () => {
    const root = container();
    const [v, setV] = createSignal(1);
    const errors: string[] = [];
    createRoot(() => {
      onError((e) => errors.push((e as Error).message));
      insert(
        root,
        createComponent(ShowC, {
          get when() {
            if (v() === 2) throw new Error('boom');
            return v() > 0;
          },
          get fallback() { return el('i', 'none'); },
          get children() { return el('b', 'yes'); },
        }),
      );
    });
    expect(root.innerHTML).toBe('<b>yes</b>');
    setV(2);
    await frame();
    expect(errors).toEqual(['boom']);
    expect(root.innerHTML).toBe('<b>yes</b>'); // the last good DOM stays
    setV(3); // truthy again: same truthiness as before the error
    await frame();
    expect(errors).toEqual(['boom']);
    expect(root.innerHTML).toBe('<b>yes</b>');
    setV(0);
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>'); // not frozen
    setV(2);
    await frame();
    expect(errors).toEqual(['boom', 'boom']);
    setV(0); // recovering into the falsy branch it was in before
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>');
    setV(5);
    await frame();
    expect(root.innerHTML).toBe('<b>yes</b>');
  });

  it('Show: the first evaluation throwing does not freeze the branch either', async () => {
    const root = container();
    const [v, setV] = createSignal(2);
    const errors: string[] = [];
    createRoot(() => {
      onError((e) => errors.push((e as Error).message));
      insert(
        root,
        createComponent(ShowC, {
          get when() {
            if (v() === 2) throw new Error('boom');
            return v() > 0;
          },
          get children() { return el('b', 'yes'); },
        }),
      );
    });
    expect(errors).toEqual(['boom']);
    expect(root.innerHTML).toBe('');
    setV(1);
    await frame();
    expect(root.innerHTML).toBe('<b>yes</b>');
  });

  it('Switch: an error in a Match condition reaches the reader; the Switch recovers', async () => {
    const root = container();
    const [v, setV] = createSignal(1);
    const errors: string[] = [];
    createRoot(() => {
      onError((e) => errors.push((e as Error).message));
      insert(
        root,
        createComponent(Switch, {
          get fallback() { return el('i', 'none'); },
          get children() {
            return [
              createComponent(MatchC, {
                get when() {
                  if (v() === 2) throw new Error('boom');
                  return v() === 1;
                },
                get children() { return el('b', 'one'); },
              }),
              createComponent(MatchC, { get when() { return v() === 3; }, get children() { return el('s', 'three'); } }),
            ];
          },
        }),
      );
    });
    expect(root.innerHTML).toBe('<b>one</b>');
    setV(2);
    await frame();
    expect(errors).toEqual(['boom']);
    setV(1); // back to the branch it was in before the error
    await frame();
    expect(root.innerHTML).toBe('<b>one</b>');
    setV(3);
    await frame();
    expect(root.innerHTML).toBe('<s>three</s>');
    setV(4);
    await frame();
    expect(root.innerHTML).toBe('<i>none</i>');
  });
});
