#!/usr/bin/env node
// results/raw/*.json (webdriver-ts) → results/latest.md, the way the upstream results page computes its table
// (webdriver-ts-results/src/Common.ts): per benchmark the MEDIAN of `total` over the runs, the factor is the value
// divided by the best (smallest) value among the frameworks of the run (vanillajs is normally that one), the
// CPU geometric mean is weighted with upstream's benchmark weights, the others are unweighted.
//
//   node bench/krausest/report.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "results");
const rawDir = join(outDir, "raw");
if (!existsSync(rawDir)) {
  console.error(`no ${rawDir}; run bench/krausest/run.mjs first`);
  process.exit(1);
}

// Same order and weights as upstream's computeGeometricMean (CPU benchmarks 01…09).
const CPU = [
  ["01_run1k", "create rows", 0.64280248137063],
  ["02_replace1k", "replace all rows", 0.5607178150466176],
  ["03_update10th1k_x16", "partial update", 0.5643800750716564],
  ["04_select1k", "select row", 0.1925635870170522],
  ["05_swap1k", "swap rows", 0.13200612879341714],
  ["06_remove-one-1k", "remove row", 0.5277091212292658],
  ["07_create10k", "create many rows", 0.5644449600965534],
  ["08_create1k-after1k_x2", "append rows to large table", 0.5508359820582848],
  ["09_clear1k_x8", "clear rows", 0.4225836631419211],
];
const MEM = [
  ["21_ready-memory", "ready memory"],
  ["22_run-memory", "run memory (1k rows)"],
  ["25_run-clear-memory", "create/clear 1k rows x5"],
];
const SIZE = [
  ["41_size-uncompressed", "uncompressed size, kB"],
  ["42_size-compressed", "brotli size, kB"],
  ["43_first-paint", "first paint, ms"],
];

// framework → benchmark id → { median, mean, stddev, n }
const data = new Map();
const idsSeen = new Set();
for (const file of readdirSync(rawDir).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(readFileSync(join(rawDir, file), "utf8"));
  const stat = r.values.total ?? r.values.DEFAULT;
  if (!stat) continue;
  const name = r.framework.replace(/-keyed$/, "");
  if (!data.has(name)) data.set(name, new Map());
  data.get(name).set(r.benchmark, { median: stat.median, mean: stat.mean, stddev: stat.stddev, n: stat.values.length });
  idsSeen.add(r.benchmark);
}
if (data.size === 0) {
  console.error("no results in raw/");
  process.exit(1);
}

const get = (fw, id) => data.get(fw)?.get(id);
const best = (id) => Math.min(...[...data.keys()].map((fw) => get(fw, id)?.median ?? Infinity));
const factor = (fw, id) => {
  const v = get(fw, id)?.median;
  return v === undefined ? NaN : v / best(id);
};
function geomean(fw, rows, weights) {
  let sum = 0;
  let weight = 0;
  rows.forEach(([id], i) => {
    const f = factor(fw, id);
    if (Number.isNaN(f)) return;
    const w = weights ? weights[i] : 1;
    sum += w * Math.log(f);
    weight += w;
  });
  return weight === 0 ? NaN : Math.exp(sum / weight);
}
const geoCpu = (fw) => geomean(fw, CPU, CPU.map((c) => c[2]));
const names = [...data.keys()].sort((a, b) => (geoCpu(a) || Infinity) - (geoCpu(b) || Infinity));

const f2 = (x) => (Number.isNaN(x) ? "—" : x.toFixed(2));
const num = (x, digits = 1) => (x >= 1000 ? x.toFixed(0) : x.toFixed(digits));
/** "median ± 95% CI (×factor)" as upstream's table cell. */
function cell(fw, id, digits = 1, withCI = true) {
  const v = get(fw, id);
  if (!v) return "—";
  const ci = withCI && v.n > 1 && v.stddev ? ` ± ${num((1.959964 * v.stddev) / Math.sqrt(v.n), 1)}` : "";
  return `${num(v.median, digits)}${ci} (${f2(factor(fw, id))})`;
}
function table(rows, { digits = 1, withCI = true, geo, weights, compareTo } = {}) {
  const head = ["", ...names];
  const present = rows.filter(([id]) => idsSeen.has(id));
  if (present.length === 0) return "_нет данных_\n";
  const lines = [`| ${head.join(" | ")} |`, `| --- | ${names.map(() => "---:").join(" | ")} |`];
  for (const [id, label] of present) {
    lines.push(`| ${label} | ${names.map((fw) => cell(fw, id, digits, withCI)).join(" | ")} |`);
  }
  if (geo) {
    lines.push(
      `| **geometric mean${weights ? " (weighted)" : ""}** | ${names.map((fw) => `**${f2(geomean(fw, present, weights && present.map(([id]) => weights[rows.findIndex((r) => r[0] === id)])))}**`).join(" | ")} |`,
    );
  }
  return lines.join("\n") + "\n";
}

const machine = existsSync(join(outDir, "machine.json")) ? JSON.parse(readFileSync(join(outDir, "machine.json"), "utf8")) : null;
const correctness = existsSync(join(outDir, "correctness.json")) ? JSON.parse(readFileSync(join(outDir, "correctness.json"), "utf8")) : null;

const summaryRows = names.map((fw) => {
  const comp = get(fw, "42_size-compressed");
  const fp = get(fw, "43_first-paint");
  return `| ${fw} | ${f2(geoCpu(fw))} | ${f2(geomean(fw, MEM))} | ${comp ? num(comp.median) : "—"} | ${fp ? num(fp.median) : "—"} |`;
});

// frameact vs solid per CPU benchmark (the comparison the README discusses).
const fa = names.find((n) => n.startsWith("frameact-"));
const so = names.find((n) => n.startsWith("solid-"));
let versus = "";
if (fa && so) {
  const rows = [...CPU, ...MEM.map(([id, l]) => [id, l])]
    .filter(([id]) => get(fa, id) && get(so, id))
    .map(([id, label]) => [label, get(fa, id).median / get(so, id).median]);
  versus = [
    `### ${fa} ÷ ${so} (медианы; > 1 — frameact медленнее / больше памяти)`,
    "",
    "| бенчмарк | отношение |",
    "| --- | ---: |",
    ...rows.sort((a, b) => b[1] - a[1]).map(([label, r]) => `| ${label} | ${f2(r)} |`),
    "",
  ].join("\n");
}

const md = [
  "# krausest/js-framework-benchmark (keyed) — локальный прогон",
  "",
  machine
    ? [
        `- Дата: ${machine.date}; upstream \`${machine.upstream}\`.`,
        `- Машина: ${machine.cpu}, ${machine.cores} ядер, ${machine.memoryGB} ГБ, ${machine.os}; Node ${machine.node}; ${machine.chrome}${machine.headless ? " (headless)" : " (окно, не headless)"}.`,
        `- Нагрузка до прогона: \`${machine.uptimeBefore}\`; после: \`${machine.uptimeAfter}\`.`,
        machine.count ? `- Итераций: ${machine.count} (переопределено \`--count\`).` : "- Итерации — дефолты upstream (15 для CPU, 1 для памяти и размера).",
        machine.failedPasses?.length ? `- Проходы основного прогона с ошибками (недостающее перезапущено ниже, если есть перезапуски): ${machine.failedPasses.join(", ")}.` : "",
        ...(machine.reruns ?? []).map(
          (r) => `- Перезапуск (\`--keep\`) ${r.date}: ${r.frameworks.join(", ")} / ${Array.isArray(r.benchmarks) ? r.benchmarks.join(", ") : r.benchmarks}; нагрузка до: \`${r.uptimeBefore}\`.`,
        ),
      ].filter(Boolean)
    : [],
  correctness
    ? [
        `- Корректность (\`${correctness.checked.join(", ")}\`): ${correctness.checks.map((c) => `${c.name} — ${c.ok ? "OK" : "FAIL"}`).join("; ")}.`,
      ]
    : [],
  "",
  "Ячейка: медиана `total` в мс (или МБ / кБ) ± 95% доверительный интервал (×отношение к лучшему значению в строке среди",
  "запущенных фреймворков — как «Slowdown» в таблице upstream). Меньше — лучше. Сравнивать с официальной таблицей нельзя.",
  "",
  "## Сводка (геометрическое среднее отношений)",
  "",
  "| фреймворк | CPU (взвешенное) | память | brotli, кБ | first paint, мс |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...summaryRows,
  "",
  "## CPU: длительность, мс",
  "",
  table(CPU, { geo: true, weights: CPU.map((c) => c[2]) }),
  versus,
  "## Память, МБ",
  "",
  table(MEM, { digits: 2, withCI: false, geo: true }),
  "## Размер и first paint",
  "",
  table(SIZE, { withCI: false }),
].flat().join("\n");

writeFileSync(join(outDir, "latest.md"), md + "\n");
console.error(`wrote ${join(outDir, "latest.md")}`);
