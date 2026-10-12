// DEV run counters, the "why did this run" log and the slow-run warnings (spec §3.4). Replaces
// teact's `debugKey` / double-click dumps: every effect run is attributed to its path and to the
// signal (or store leaf) whose write scheduled it.
import { DEV } from '../env';
import { getEffectDebugInfo, setRunObserver, type EffectNode } from '../core/effects';
import { getDrainingPhase, setDrainObserver, type FramePhase } from '../core/frame';
import { describeNode, effectPath } from '../core/debug';
import { getPhase } from '../scheduler/fasterdom';

/** An effect run, or one frame-phase drain, slower than this is reported (`console.warn`). */
export const SLOW_RUN_MS = 7;

export interface RunStats {
  /** `Message > MessageMeta > span.style:color` */
  path: string;
  /** Observed scheduled runs (the creation run is not observed). */
  runs: number;
  totalMs: number;
  maxMs: number;
}

export interface RunLogOptions {
  /** Log only the effects whose path matches (a substring, or a RegExp). */
  filter?: string | RegExp;
}

let logging = false;
let filter: RegExp | null = null;
let attached = false;
/** Who wants the observers: stricterdom (slow-run warnings + counters) and/or the run log. */
let wantedByStrict = false;
const stats = new Map<string, RunStats>();
/** The slowest run of the drain in progress (runs outside a frame drain — tickEnd, idle — are not part of one). */
let drainSlowest: { path: string; ms: number } | null = null;
/** An effect's owner chain never changes: its path is built once, not on every run. */
const paths = new WeakMap<EffectNode, string>();

function pathOf(node: EffectNode): string {
  let path = paths.get(node);
  if (path === undefined) paths.set(node, (path = effectPath(node)));
  return path;
}

function onRun(node: EffectNode, ms: number) {
  const path = pathOf(node);
  let entry = stats.get(path);
  if (entry === undefined) {
    entry = { path, runs: 0, totalMs: 0, maxMs: 0 };
    stats.set(path, entry);
  }
  entry.runs++;
  entry.totalMs += ms;
  if (ms > entry.maxMs) entry.maxMs = ms;
  if (getDrainingPhase() !== null && (drainSlowest === null || ms > drainSlowest.ms)) drainSlowest = { path, ms };
  if (ms > SLOW_RUN_MS) console.warn(`[frameact] Slow effect run: ${ms.toFixed(1)} ms in ${path} [${getPhase()}]`);
  if (logging && (filter === null || path.search(filter) !== -1)) { // (search: a /g filter has no lastIndex state)
    const info = getEffectDebugInfo(node)!;
    const why =
      info.root === null
        ? 'rescheduled (no write recorded)'
        : info.dep === info.root
          ? describeNode(info.root)
          : `${describeNode(info.root)} via ${describeNode(info.dep)}`;
    console.log(`[frameact] run #${info.runs} ${path} [${getPhase()}] ← ${why}`);
  }
}

function onDrain(phase: FramePhase, ms: number, runs: number) {
  if (ms > SLOW_RUN_MS) {
    const slowest = drainSlowest === null ? '' : `; slowest: ${drainSlowest.path} (${drainSlowest.ms.toFixed(1)} ms)`;
    console.warn(`[frameact] Slow ${phase} drain: ${ms.toFixed(1)} ms, ${runs} effect run${runs === 1 ? '' : 's'}${slowest}`);
  }
  drainSlowest = null;
}

function syncObservers() {
  const wanted = wantedByStrict || logging;
  if (wanted === attached) return;
  attached = wanted;
  setRunObserver(wanted ? onRun : null);
  setDrainObserver(wanted ? onDrain : null);
  if (!wanted) drainSlowest = null;
}

/** @internal stricterdom.ts: enableStrict()/disableStrict() turn the counters and slow-run warnings on/off. */
export function setStrictProfiling(on: boolean) {
  if (!DEV) return;
  wantedByStrict = on;
  syncObservers();
}

/** Log every effect run with its path, phase and the write that scheduled it (DEV; a no-op in production). */
export function enableRunLog(options: RunLogOptions = {}): void {
  if (!DEV) return;
  const f = options.filter;
  filter = f === undefined ? null : typeof f === 'string' ? new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : f;
  logging = true;
  syncObservers();
}

export function disableRunLog(): void {
  if (!DEV) return;
  logging = false;
  filter = null;
  syncObservers();
}

/** Per-path counters since the last reset, most runs first. Empty in production and while nothing observes runs. */
export function getRunStats(): RunStats[] {
  const out: RunStats[] = [];
  for (const entry of stats.values()) {
    // insertion sort by runs, descending (lib ES2022 has no toSorted; .sort() is linted)
    let i = out.length;
    while (i > 0 && out[i - 1].runs < entry.runs) i--;
    out.splice(i, 0, { ...entry });
  }
  return out;
}

export function resetRunStats(): void {
  stats.clear();
}
