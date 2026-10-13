#!/usr/bin/env node
// Memory and first-paint diagnostics for the krausest apps, the way upstream's webdriver-ts measures them
// (same Chrome flags, `window.gc` + `performance.measureUserAgentSpecificMemory()`, `performance` paint
// entries) plus what upstream does not give: several samples, resource/evaluate timings and V8 heap
// snapshots aggregated by constructor. Needs `bench/krausest/run.mjs --check` to have run once (upstream
// checkout, webdriver-ts deps, built frameworks) and upstream's server on PORT (default 8080):
//   (cd bench/krausest/.upstream/server && PORT=8080 node_modules/.bin/tsx index.ts &)
//
//   node bench/krausest/heap.mjs --fw frameact,solid --fp 7 [--trace]   first paint (43_): N fresh browsers each,
//                                       with the main.js fetch time (the server brotli-compresses on the fly) and,
//                                       with --trace, EvaluateScript / v8.compile durations from a Chrome trace
//   node bench/krausest/heap.mjs --fw frameact,solid --mem 3           21_/22_/25_ via measureUserAgentSpecificMemory
//                                       (+ usedJSHeapSize, 3 decimals: the UA number is rounded to 0.1 MB)
//   node bench/krausest/heap.mjs --fw frameact,solid --snap <dir>      heap snapshots ready / run 1k / create+clear x5:
//                                       per-constructor self sizes, the run-1k delta per row, what stays after
//                                       clear, the largest JS objects with one retainer chain each; JSON per fw in <dir>
//   --fw names directories under .upstream/frameworks/keyed/ (a copy of frameact/ with another dist/main.js
//   serves to compare variants side by side); --headless for headless Chrome (upstream's default is a window).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WD = join(here, '.upstream/webdriver-ts/');
const require = createRequire(WD);
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = `http://localhost:${Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080}`;

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const fws = opt('--fw', 'frameact').split(',');
const fpN = Number(opt('--fp', 0));
const memN = Number(opt('--mem', 0));
const snapDir = opt('--snap', null);
const headless = argv.includes('--headless');
const trace = argv.includes('--trace');
const uriOf = (fw) => `frameworks/keyed/${fw}/index.html`;

async function startBrowser() {
  const args = [
    '--window-size=1280,800', '--js-flags=--expose-gc', '--no-default-browser-check', '--disable-sync', '--no-first-run',
    '--ash-no-nudges', '--disable-extensions', '--disable-features=Translate,PrivacySandboxSettings4,IPH_SidePanelGenericMenuFeature',
  ];
  if (headless) args.push('--headless=new');
  return puppeteer.launch({ headless: false, executablePath: CHROME, args, defaultViewport: { width: 1280, height: 800 } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(page, sel) {
  const el = await page.waitForSelector(`pierce/${sel}`, { timeout: 10000 });
  await el.click();
}
async function waitText(page, sel, text) {
  await page.waitForFunction((s, t) => document.querySelector(s)?.textContent?.includes(t), { timeout: 10000 }, sel, text);
}
async function waitGone(page, sel) {
  await page.waitForFunction((s) => !document.querySelector(s), { timeout: 10000 }, sel);
}
const gc = (page) => page.evaluate("window.gc({type:'major',execution:'sync',flavor:'last-resort'})");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (a) => `${median(a).toFixed(1)} (${a.map((x) => x.toFixed(1)).join(' ')})`;

// ---- first paint --------------------------------------------------------------------------
async function firstPaint(fw) {
  const samples = { fp: [], fcp: [], jsDur: [], jsEnd: [], evalMs: [], compileMs: [], domInteractive: [] };
  for (let i = 0; i < fpN; i++) {
    const browser = await startBrowser();
    try {
      const page = await browser.newPage();
      if ((await (await fetch(`${HOST}/enableCompression`)).text()) !== 'OK') throw new Error('enableCompression');
      if (trace) await page.tracing.start({ categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.compile'] });
      await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
      await click(page, '#run');
      await waitText(page, 'tbody>tr:nth-of-type(1)>td:nth-of-type(1)', '1');
      const info = await page.evaluate(() => {
        const paint = performance.getEntriesByType('paint');
        const nav = performance.getEntriesByType('navigation')[0];
        const js = performance.getEntriesByType('resource').find((r) => /main\.js|Main\.js/.test(r.name));
        return {
          fp: paint.find((e) => e.name === 'first-paint')?.startTime,
          fcp: paint.find((e) => e.name === 'first-contentful-paint')?.startTime,
          jsStart: js?.startTime, jsEnd: js?.responseEnd, jsSize: js?.encodedBodySize, jsDecoded: js?.decodedBodySize,
          domInteractive: nav?.domInteractive,
        };
      });
      let evalMs = 0, compileMs = 0;
      if (trace) {
        const buf = await page.tracing.stop();
        const events = JSON.parse(Buffer.from(buf).toString()).traceEvents;
        for (const e of events) {
          const url = e.args?.data?.url ?? e.args?.fileName ?? '';
          if (!/main\.js|Main\.js/i.test(url)) continue;
          if (e.name === 'EvaluateScript' && e.dur) evalMs += e.dur / 1000;
          if ((e.name === 'v8.compile' || e.name === 'V8.CompileScript' || e.name === 'v8.compileModule') && e.dur) compileMs += e.dur / 1000;
        }
      }
      await fetch(`${HOST}/disableCompression`);
      samples.fp.push(info.fp); samples.fcp.push(info.fcp ?? NaN); samples.jsDur.push(info.jsEnd - info.jsStart); samples.jsEnd.push(info.jsEnd);
      samples.domInteractive.push(info.domInteractive); samples.evalMs.push(evalMs); samples.compileMs.push(compileMs);
      if (i === 0) console.log(`  ${fw}: main.js encoded ${info.jsSize} B, decoded ${info.jsDecoded} B`);
    } finally {
      await browser.close();
    }
  }
  console.log(`${fw.padEnd(12)} first-paint ${fmt(samples.fp)} | js fetch ${fmt(samples.jsDur)} ms, js responseEnd ${fmt(samples.jsEnd)} | domInteractive ${fmt(samples.domInteractive)}${trace ? ` | evaluate ${fmt(samples.evalMs)} compile ${fmt(samples.compileMs)}` : ''}`);
  return samples;
}

// ---- memory (upstream method) ------------------------------------------------------------
async function memory(fw) {
  const steps = {
    '21_ready': async () => {},
    '22_run': async (page) => { await click(page, '#run'); await page.waitForSelector('pierce/tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a'); },
    '25_run-clear5': async (page) => {
      for (let i = 0; i < 5; i++) {
        await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', String(1000 * (i + 1)));
        await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)');
      }
    },
  };
  const out = {};
  for (const [id, run] of Object.entries(steps)) {
    const res = [], heap = [];
    for (let i = 0; i < memN; i++) {
      const browser = await startBrowser();
      try {
        const page = await browser.newPage();
        await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('pierce/#run');
        await run(page);
        await gc(page); await sleep(40);
        res.push((await page.evaluate('performance.measureUserAgentSpecificMemory()')).bytes / 1024 / 1024);
        heap.push((await page.evaluate('performance.memory.usedJSHeapSize')) / 1024 / 1024);
      } finally { await browser.close(); }
    }
    out[id] = res;
    console.log(`${fw.padEnd(12)} ${id.padEnd(14)} UA-memory MB ${fmt(res)} | usedJSHeapSize MB ${heap.map((x) => x.toFixed(3)).join(' ')}`);
  }
  return out;
}

// ---- heap snapshots ----------------------------------------------------------------------
async function takeSnapshot(page) {
  const client = await page.createCDPSession();
  const chunks = [];
  client.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  await client.detach();
  return JSON.parse(chunks.join(''));
}
/** Aggregate (type:name) → { count, size }; also total. */
function aggregate(snap) {
  const m = snap.snapshot.meta;
  const fields = m.node_fields, n = fields.length;
  const types = m.node_types[0];
  const iType = fields.indexOf('type'), iName = fields.indexOf('name'), iSize = fields.indexOf('self_size');
  const nodes = snap.nodes, strings = snap.strings;
  const agg = new Map();
  let total = 0;
  for (let i = 0; i < nodes.length; i += n) {
    const type = types[nodes[i + iType]];
    let name = strings[nodes[i + iName]];
    if (type === 'native' || type === 'code') name = `${type} ${name.replace(/^(system \/ )?/, '')}`;
    else if (type === 'closure' || type === 'concatenated string' || type === 'sliced string' || type === 'string' || type === 'number' || type === 'hidden' || type === 'synthetic' || type === 'bigint' || type === 'regexp' || type === 'symbol' || type === 'object shape') {
      // group by type for the noisy kinds; closures keep their function name (per-row closures matter)
      name = type === 'closure' ? `closure ${name}` : type === 'object shape' ? 'shape' : type;
    } else if (type === 'array') name = `array ${name}`;
    const key = `${type === 'object' ? '' : ''}${name}`;
    const e = agg.get(key) ?? { count: 0, size: 0 };
    e.count++; e.size += nodes[i + iSize]; total += nodes[i + iSize];
    agg.set(key, e);
  }
  return { agg, total, nodeCount: nodes.length / n };
}
function diff(a, b, label, perRow = 1, min = 2000) {
  const rows = [];
  for (const [k, vb] of b.agg) {
    const va = a.agg.get(k) ?? { count: 0, size: 0 };
    const dc = vb.count - va.count, ds = vb.size - va.size;
    if (Math.abs(ds) >= min || Math.abs(dc) >= perRow * 0.9 * 1000) rows.push([k, dc, ds]);
  }
  for (const [k, va] of a.agg) if (!b.agg.has(k) && va.size >= min) rows.push([k, -va.count, -va.size]);
  rows.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]));
  console.log(`\n== ${label}: total self size ${((b.total - a.total) / 1024).toFixed(1)} kB (${a.total / 1024 | 0} → ${b.total / 1024 | 0} kB), nodes ${a.nodeCount} → ${b.nodeCount}`);
  console.log(`${'delta count'.padStart(12)} ${'delta kB'.padStart(9)} ${'per row B'.padStart(10)}  constructor`);
  for (const [k, dc, ds] of rows.slice(0, 45)) console.log(`${String(dc).padStart(12)} ${(ds / 1024).toFixed(1).padStart(9)} ${(ds / perRow).toFixed(0).padStart(10)}  ${k}`);
}
function top(s, label, n = 30) {
  const rows = [...s.agg].sort((x, y) => y[1].size - x[1].size).slice(0, n);
  console.log(`\n== ${label}: total self size ${(s.total / 1024).toFixed(1)} kB, ${s.nodeCount} nodes`);
  for (const [k, v] of rows) console.log(`${String(v.count).padStart(8)} ${(v.size / 1024).toFixed(1).padStart(8)} kB  ${k}`);
}
/** The biggest array/object nodes (self size) of a raw snapshot with one retainer chain each. */
function retainers(snap, label, n = 12) {
  const m = snap.snapshot.meta;
  const nf = m.node_fields, nn = nf.length, ef = m.edge_fields, ne = ef.length;
  const types = m.node_types[0], etypes = m.edge_types[0];
  const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iSize = nf.indexOf('self_size'), iEdges = nf.indexOf('edge_count');
  const eType = ef.indexOf('type'), eName = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const nodes = snap.nodes, edges = snap.edges, strings = snap.strings;
  const count = nodes.length / nn;
  // first edge index per node + reverse edges
  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * nn + iEdges] * ne; }
  firstEdge[count] = edges.length;
  const back = new Map(); // to node index -> [from node index, edge idx]
  for (let i = 0; i < count; i++) {
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += ne) {
      const et = etypes[edges[e + eType]];
      if (et === 'weak' || et === 'shortcut') continue;
      const to = edges[e + eTo] / nn;
      if (!back.has(to)) back.set(to, [i, e]); // (first retainer is enough for a chain)
    }
  }
  const desc = (i) => { const t = types[nodes[i * nn + iType]]; const nm = strings[nodes[i * nn + iName]]; return `${t}:${nm.slice(0, 40)}#${i}(${nodes[i * nn + iSize]}B)`; };
  const edesc = (e) => { const et = etypes[edges[e + eType]]; const x = edges[e + eName]; return et === 'element' || et === 'hidden' ? `[${x}]` : `.${strings[x]}`; };
  const big = [];
  for (let i = 0; i < count; i++) {
    const t = types[nodes[i * nn + iType]];
    if (t === 'native' || t === 'code' || t === 'synthetic' || t === 'object shape' || t === 'string' || t === 'concatenated string') continue;
    big.push([nodes[i * nn + iSize], i]);
  }
  big.sort((a, b) => b[0] - a[0]);
  console.log(`\n== ${label}: largest JS-heap objects`);
  for (const [size, i] of big.slice(0, n)) {
    let chain = desc(i), cur = i;
    for (let d = 0; d < 7; d++) { const r = back.get(cur); if (!r) break; chain = `${desc(r[0])} ${edesc(r[1])} -> ` + chain; cur = r[0]; if (types[nodes[cur * nn + iType]] === 'synthetic') break; }
    console.log(`${String(size).padStart(8)} B  ${chain}`);
  }
}

async function snapshots(fw) {
  const browser = await startBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('pierce/#run');
    await gc(page); await sleep(40);
    const ready = aggregate(await takeSnapshot(page));
    await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', '1000');
    await gc(page); await sleep(40);
    const run = aggregate(await takeSnapshot(page));
    await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1)');
    for (let i = 1; i < 5; i++) {
      await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', String(1000 * (i + 1)));
      await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1)');
    }
    await gc(page); await sleep(40);
    const rawClear5 = await takeSnapshot(page);
    const clear5 = aggregate(rawClear5);
    const ua = async () => (await page.evaluate('performance.measureUserAgentSpecificMemory()')).bytes / 1024 / 1024;
    console.log(`\n#### ${fw}  (UA memory now, after clear5: ${(await ua()).toFixed(3)} MB)`);
    top(ready, `${fw} ready (top constructors)`);
    diff(ready, run, `${fw} run 1k − ready (per row = /1000)`, 1000);
    diff(ready, clear5, `${fw} clear×5 − ready (retained after clear)`, 1, 500);
    retainers(rawClear5, `${fw} after clear×5`);
    if (snapDir) {
      mkdirSync(snapDir, { recursive: true });
      const dump = (s) => Object.fromEntries([...s.agg].map(([k, v]) => [k, v]));
      writeFileSync(join(snapDir, `${fw}.json`), JSON.stringify({ ready: dump(ready), run: dump(run), clear5: dump(clear5), totals: { ready: ready.total, run: run.total, clear5: clear5.total } }));
    }
  } finally { await browser.close(); }
}

for (const fw of fws) {
  if (fpN) await firstPaint(fw);
  if (memN) await memory(fw);
  if (snapDir) await snapshots(fw);
}
