// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/lib/fasterdom/stricterdom.ts
// frameact: the phase comes from the scheduler (`getPhase`), mutation records are drained at every
// phase change and around every effect apply (so a violation is reported in the phase it happened
// in and attributed to the effect that was running), `suppressStrict` is a counter instead of an
// unpatch/repatch, and the error carries the attribution path (spec §3.4).
// `data-stricterdom-ignore`, the `details[open]` exception and the `allowAnyPhase` flag mirror the behaviour
// of telegram-tt's stricterdom (GPL-3.0); they are re-implemented here from the behaviour alone, no code taken.
import { DEV } from '../env';
import { getPhase, onPhaseChange, type Phase } from '../scheduler/fasterdom';
import { getRunningEffect, setApplyHook } from '../core/effects';
import { effectPath, quoteUntrusted, reportDevHookError, safeName } from '../core/debug';
import { getNatives } from '../dom/natives';
import { strictHooks } from '../dom/strict';
import { LAYOUT_CAUSES } from './layoutCauses';
import { setStrictProfiling } from './runlog';

export type StrictViolationKind = 'measure' | 'mutation';

/**
 * What stricterdom reports: a layout read outside the measure phase, or a live-DOM write outside the mutate phase.
 * `message` and `path` may carry text derived from untrusted content (ids and classes of the mutated element,
 * store keys): ids and classes are quoted and cut to 64 characters, but the text is still plain text. A dev
 * overlay must show it with `textContent`, never `innerHTML`, and mount itself under `data-stricterdom-ignore`.
 */
export class StrictViolationError extends Error {
  override readonly name: string = 'StrictViolationError';
  constructor(
    /** `measure`: a layout-forcing getter/method was called; `mutation`: a MutationObserver record. */
    readonly kind: StrictViolationKind,
    /** The getter/method name (`offsetHeight`), the attribute name (`class`) or `childList`. (`cause` is taken by `Error`.) */
    readonly detail: string,
    /** The phase the violation happened in. */
    readonly phase: Phase,
    /** `Message > MessageMeta > span.style:color` — the effect that was running, or null. */
    readonly path: string | null,
    /** The mutated node (mutation violations), or null. */
    readonly target: Node | null,
  ) {
    super(
      kind === 'measure'
        ? `[frameact/stricterdom] Unexpected measurement \`${detail}\` ${path === null ? 'outside an effect' : `in ${path}`} [${phase}]`
        : `[frameact/stricterdom] Unexpected mutation \`${detail}\` of ${describeTarget(target)} ${path === null ? 'outside an effect' : `in ${path}`} [${phase}]`,
    );
  }
}

export type StrictErrorHandler = (error: StrictViolationError) => void;

/** `<div class="x">` for the error message (through the prototype natives: a form's controls may shadow its properties). */
function describeTarget(node: Node | null): string {
  if (node === null) return '<unknown>';
  const { nodeType, nodeName, localName } = getNatives();
  if (nodeType.call(node) !== 1) return `#${nodeName.call(node).toLowerCase()}`;
  const getAttribute = Element.prototype.getAttribute;
  // id / class are content-derived (`id="msg-${m.id}"`): quoted and cut, so they cannot forge a log line
  let out = `<${safeName(localName.call(node as Element))}`;
  const id = getAttribute.call(node as Element, 'id');
  if (id) out += ` id=${quoteUntrusted(id)}`;
  const cls = getAttribute.call(node as Element, 'class');
  if (cls) out += ` class=${quoteUntrusted(cls)}`;
  return `${out}>`;
}

/** Elements under an ancestor with this attribute may be mutated in any phase (a contentEditable composer, third-party widgets). */
export const IGNORE_SUBTREE_ATTR = 'data-stricterdom-ignore';

const DEFAULT_ERROR_HANDLER: StrictErrorHandler = (error) => {
  console.error(error);
};
let onError: StrictErrorHandler = DEFAULT_ERROR_HANDLER;

let isStrict = false;
/** `forceMeasure` overrides the scheduler's phase for the layout-read check while its callback runs. */
let forcedPhase: Phase | null = null;
/** `suppressStrict` nesting depth: > 0 silences both checks. */
let suppressed = 0;
/** True while the violation handler runs: what it reads or writes (an overlay in <body>) is not a violation. */
let reporting = false;
let observer: MutationObserver | undefined;
let unsubscribePhase: (() => void) | undefined;
/** The phase the pending mutation records were produced in (mirrors the scheduler; updated by the phase listener). */
let recordsPhase: Phase = 'measure';
const forcedMutationAllowedFor = new Set<Node>();
/** Undo functions of the installed layout patches (run by `disableStrict`). */
const restores: (() => void)[] = [];

function effectivePhase(): Phase {
  return forcedPhase ?? getPhase();
}

/** The attribution path of the running effect, or null outside effects. */
function runningPath(): string | null {
  const node = getRunningEffect();
  return node === null ? null : effectPath(node);
}

/** The seam used by `render()`/`Portal`: the writes to `nodes` inside `cb` are sanctioned whatever the phase. */
function allowMutation<T>(nodes: Node | Node[], cb: () => T): T {
  if (!isStrict) return cb();
  drainRecords(); // earlier records are judged on their own, not under this whitelist
  // Only the nodes added here are removed at the end: a nested sanction of the same node (a Portal
  // inside a Portal, both mounting into <body>) must not end the outer one.
  const added: Node[] = [];
  for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
    if (forcedMutationAllowedFor.has(node)) continue;
    forcedMutationAllowedFor.add(node);
    added.push(node);
  }
  try {
    return cb();
  } finally {
    drainRecords(); // the callback's records are checked now, with the whitelist in force
    for (const node of added) forcedMutationAllowedFor.delete(node);
  }
}

/**
 * Install the DEV phase checks: layout-forcing getters/methods throw/report outside the measure
 * phase, live-DOM mutations are reported outside the mutate phase. A no-op in production builds
 * (`DEV` is false: the whole module tree-shakes to thin wrappers) and when already enabled.
 */
export function enableStrict(): void {
  if (!DEV || isStrict) return;
  if (typeof document === 'undefined' || !getNatives().body.call(document)) {
    throw new Error('[frameact/stricterdom] enableStrict() needs a document with a <body>');
  }
  isStrict = true;
  try {
    setupLayoutDetectors();
    setupMutationObserver();
    recordsPhase = getPhase();
    unsubscribePhase = onPhaseChange((next) => {
      // Records produced since the last change belong to the phase that just ended.
      drainRecordsAs(recordsPhase);
      recordsPhase = next;
    });
    // Around an apply outside the mutate phase: before it, pending records belong to the context
    // around the apply; after it, to the effect (the asynchronous observer callback would know neither).
    setApplyHook(() => {
      if (effectivePhase() !== 'mutate') drainRecords();
    });
    strictHooks.forceMutation = (cb, target) => allowMutation(target, cb);
    setStrictProfiling(true); // run counters and the slow-run / slow-drain warnings (runlog.ts)
  } catch (error) {
    disableStrict(); // frozen prototypes, no MutationObserver: never stay half on
    throw error;
  }
}

export function disableStrict(): void {
  if (!DEV || !isStrict) return;
  drainRecords();
  setStrictProfiling(false);
  strictHooks.forceMutation = (cb) => cb();
  setApplyHook(null);
  unsubscribePhase?.();
  unsubscribePhase = undefined;
  clearMutationObserver();
  clearLayoutDetectors();
  forcedMutationAllowedFor.clear();
  isStrict = false; // (forcedPhase / suppressed are balanced by the try/finally of the windows still open)
}

export function isStrictEnabled(): boolean {
  return isStrict;
}

/**
 * Read layout from the mutate phase (the scroll-anchor pattern: snapshot before writing): inside the
 * mutate phase, `cb` runs as a measure window (layout reads allowed, a DOM write is a violation).
 * Anywhere else it is a plain `cb()` — layout reads are allowed there anyway, and helpers that use it
 * are called from both contexts. Production: `cb()`.
 */
export function forceMeasure<T>(cb: () => T): T {
  if (!DEV || !isStrict || effectivePhase() !== 'mutate') return cb();
  drainRecords(); // records of the mutate phase so far: legitimate, cleared
  forcedPhase = 'measure';
  try {
    return cb();
  } finally {
    forcedPhase = null;
    drainRecordsAs('measure'); // a write inside the measure window is a violation
  }
}

/**
 * Write to `nodes` from the measure phase: a mount into an attached container, an imperative widget.
 * Sanctioned are the records whose target is one of `nodes` (their child lists, their attributes);
 * writes to other attached nodes, their attached descendants included, are still violations. DEV: a
 * precondition error when called in the mutate phase unless `allowAnyPhase` (a helper used from both
 * contexts). Production: `cb()`.
 */
export function forceMutation<T>(cb: () => T, nodes: Node | Node[], allowAnyPhase?: boolean): T {
  if (!DEV) return cb();
  if (!allowAnyPhase && effectivePhase() !== 'measure') {
    throw new Error("[frameact/stricterdom] forceMutation(): the current phase is 'mutate' already");
  }
  return allowMutation(nodes, cb);
}

/** Run `cb` with both checks off (third-party code that reads and writes as it likes). Re-entrant. */
export function suppressStrict<T>(cb: () => T): T {
  if (!DEV || !isStrict) return cb();
  drainRecords(); // violations before the suppressed window are still reported
  suppressed++;
  try {
    return cb();
  } finally {
    if (--suppressed === 0) observer?.takeRecords(); // the window's records are discarded
  }
}

/** Replace the default `console.error` handler; `setHandler()` restores it. */
export function setHandler(handler?: StrictErrorHandler): void {
  onError = handler ?? DEFAULT_ERROR_HANDLER;
}

// ---- layout detectors ---------------------------------------------------------

/**
 * What a wrapper of ours forwards to. A wrapper can outlive `disableStrict` (a foreign patch such
 * as `vi.spyOn` was put over it, and its own restore reinstalls the wrapper later): it is inert
 * while strict is off, and the next `enableStrict` unwraps it instead of wrapping it again.
 */
const wrapped = new WeakMap<object, unknown>();

function setupLayoutDetectors() {
  for (const name of Object.keys(LAYOUT_CAUSES)) {
    const entity = (globalThis as Record<string, unknown>)[name];
    if (!entity) continue;
    const target = (typeof entity === 'object' ? entity : (entity as { prototype: object }).prototype) as Record<string, unknown>;
    const causes = LAYOUT_CAUSES[name];
    for (const prop of causes.props ?? []) {
      const found = Object.getOwnPropertyDescriptor(target, prop)?.get;
      if (!found) continue; // not implemented here (jsdom lacks some)
      const nativeGetter = (wrapped.get(found) as typeof found | undefined) ?? found;
      // Only `get` is replaced: an existing setter (scrollTop, innerText) stays.
      const wrapper = {
        get(this: unknown) {
          onMeasure(prop);
          return nativeGetter.call(this);
        },
      }.get;
      wrapped.set(wrapper, nativeGetter);
      Object.defineProperty(target, prop, { get: wrapper });
      restores.push(() => {
        // Only if still ours: a foreign patch installed over it is left alone (it forwards to the inert wrapper).
        if (Object.getOwnPropertyDescriptor(target, prop)?.get === wrapper) Object.defineProperty(target, prop, { get: nativeGetter });
      });
    }
    for (const method of causes.methods ?? []) {
      const found = target[method];
      if (typeof found !== 'function') continue;
      const nativeMethod = (wrapped.get(found) as typeof found | undefined) ?? found;
      const wrapper = function (this: unknown, ...args: unknown[]) {
        onMeasure(method);
        return (nativeMethod as (...a: unknown[]) => unknown).apply(this, args);
      };
      wrapped.set(wrapper, nativeMethod);
      target[method] = wrapper;
      restores.push(() => {
        if (target[method] === wrapper) target[method] = nativeMethod;
      });
    }
  }
}

function clearLayoutDetectors() {
  for (const restore of restores.splice(0)) restore();
}

function onMeasure(name: string) {
  if (!isStrict || suppressed > 0 || reporting) return;
  const phase = effectivePhase();
  if (phase === 'measure') return;
  // Called synchronously from the patched getter: a throwing handler reaches the caller.
  report(new StrictViolationError('measure', name, phase, runningPath(), null));
}

/**
 * Hand a violation to the handler. Re-entrancy guard: a handler that writes to <body> (a dev
 * overlay) or reads layout (to position it) would otherwise report itself forever / recurse; its
 * own records are discarded, its reads are not checked.
 */
function report(error: StrictViolationError) {
  if (reporting) return;
  reporting = true;
  try {
    onError(error);
  } finally {
    reporting = false;
    observer?.takeRecords();
  }
}

// ---- mutation observer --------------------------------------------------------

function setupMutationObserver() {
  observer = new MutationObserver((records) => {
    checkRecords(records, effectivePhase());
  });
  observer.observe(getNatives().body.call(document)!, { childList: true, attributes: true, subtree: true, characterData: false });
}

function clearMutationObserver() {
  observer?.disconnect(); // pending records are discarded with it
  observer = undefined;
}

/** Check the pending records against the current phase (synchronous: attributed to the running effect). */
function drainRecords() {
  drainRecordsAs(effectivePhase());
}

function drainRecordsAs(phase: Phase) {
  if (observer === undefined) return;
  try {
    const records = observer.takeRecords();
    if (records.length) checkRecords(records, phase);
  } catch (error) {
    // Called from a phase listener and around applies: nothing here may throw into fasterdom or the core.
    reportDevHookError('stricterdom: checking mutation records', error);
  }
}

function isEditable(el: HTMLElement, closest: Element['closest']): boolean {
  const flag = (el as { isContentEditable?: boolean }).isContentEditable;
  if (typeof flag === 'boolean') return flag;
  return closest.call(el, '[contenteditable]:not([contenteditable="false"])') !== null; // jsdom has no isContentEditable
}

function checkRecords(records: MutationRecord[], phase: Phase) {
  if (phase === 'mutate' || suppressed > 0) return;
  const path = runningPath();
  // Prototype natives: content-named elements may shadow `document.contains` or a form's `closest` (natives.ts).
  const { contains, nodeType, parentNode } = getNatives();
  const closest = Element.prototype.closest;
  for (const { target, type, attributeName } of records) {
    if (!contains.call(document, target)) continue; // detached meanwhile (a subtree removed in the same pass)
    if (forcedMutationAllowedFor.has(target)) continue;
    const element = (nodeType.call(target) === 1 ? target : parentNode.call(target)) as Element | null;
    if (element !== null && nodeType.call(element) === 1 && closest.call(element, `[${IGNORE_SUBTREE_ATTR}]`)) continue;
    if (type === 'childList' && target instanceof HTMLElement && isEditable(target, closest)) continue; // the engine edits a composer
    if (attributeName?.startsWith('data-')) continue; // data-* is state for CSS and scripts, not layout
    if (attributeName === 'open' && target instanceof HTMLDetailsElement) continue; // toggled by the user agent
    const detail = type === 'attributes' ? safeName(attributeName!) : type;
    try {
      report(new StrictViolationError('mutation', detail, phase, path, target));
    } catch (error) {
      // A throwing handler must not break a drain or the observer callback (nor a throwing console.error under it).
      reportDevHookError('stricterdom violation handler', error);
    }
  }
}
