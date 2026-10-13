#!/usr/bin/env node
// Runs krausest/js-framework-benchmark (keyed, pinned commit) with the frameact implementation added —
// no fork needed, and only the frameworks listed below are installed (not the 180+ upstream ones).
//
//   node bench/krausest/run.mjs                 setup + correctness + full benchmark → bench/krausest/results/
//   node bench/krausest/run.mjs --check         setup + build + correctness checks only (no benchmark)
//   node bench/krausest/run.mjs --report        only regenerate results/latest.md from results/raw/
//   node bench/krausest/run.mjs --count 3       override the number of iterations (default: upstream's 15 CPU / 1 mem)
//   node bench/krausest/run.mjs --frameworks frameact,solid   subset (names of frameworks/keyed/*)
//   node bench/krausest/run.mjs --check-all     correctness checks for every selected framework, not only frameact
//   node bench/krausest/run.mjs --frameworks frameact --benchmark 01_ --keep   re-run one benchmark (e.g. after a
//                                               Chrome protocol timeout) and merge it into the existing results
//   node bench/krausest/run.mjs --headless      headless Chrome (upstream default is a visible window; numbers differ)
//
// Steps: clone/fetch upstream at SHA into .upstream/ (git-ignored) → reset it → pnpm-pack frameact (src only)
// into the framework dir → install server + webdriver-ts + the selected frameworks (lockfiles of upstream,
// `--ignore-scripts`) → build → start upstream's server → upstream's own checks for frameact (smoketest,
// isKeyed, CSP) → webdriver-ts benchmarks with upstream defaults → copy results → report.mjs.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/krausest/js-framework-benchmark";
const SHA = "bf894b681fb56433ccb6efb4a3c93e35eda2b20d"; // master on 2026-10-04 (Chrome 155 era)
const ALL_FRAMEWORKS = ["frameact", "solid", "svelte", "vue", "preact-signals", "preact-hooks", "vanillajs"];
const CHROME = process.env.CHROME_BINARY ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080;
const MAX_LOAD = 8; // 1-minute load average above which the run waits (up to WAIT_MAX_MS), then records it

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const up = join(here, ".upstream");
const stage = join(here, ".stage");
const outDir = join(here, "results");
const rawDir = join(outDir, "raw");
const logFile = join(outDir, "run.log");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const frameworks = opt("--frameworks") ? opt("--frameworks").split(",") : ALL_FRAMEWORKS;
for (const f of frameworks) {
  if (!ALL_FRAMEWORKS.includes(f)) fail(`unknown framework "${f}" (known: ${ALL_FRAMEWORKS.join(", ")})`);
}
const keyed = frameworks.map((f) => `keyed/${f}`);
const count = opt("--count");
const onlyBenchmarks = opt("--benchmark")?.split(","); // id prefixes, e.g. 01_,25_
const keep = flag("--keep"); // keep earlier results/raw and merge the new ones into them
const headless = flag("--headless");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const log = (text) => appendFileSync(logFile, text);

/** Runs a command, mirrors its output to the console and results/run.log; resolves with the exit code. */
function run(cmd, args, { cwd = up, env = {}, quiet = false, allowFail = false, capture = null } = {}) {
  const line = `\n$ ${cmd} ${args.join(" ")}   (in ${cwd.replace(root, ".")})\n`;
  console.error(line);
  log(line);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["inherit", "pipe", "pipe"] });
    const forward = (stream, sink) =>
      stream.on("data", (chunk) => {
        if (!quiet) sink.write(chunk);
        log(chunk.toString());
        capture?.push(chunk.toString());
      });
    forward(child.stdout, process.stderr);
    forward(child.stderr, process.stderr);
    child.on("close", (code) => {
      if (code !== 0 && !allowFail) fail(`failed (exit ${code}): ${cmd} ${args.join(" ")}`);
      resolve(code ?? 1);
    });
  });
}
const out = (cmd, args, cwd = up) => spawnSync(cmd, args, { cwd, encoding: "utf8" }).stdout?.trim() ?? "";

// --report: only the table.
if (flag("--report")) {
  await import("./report.mjs");
  process.exit(0);
}

if (keep) log(`\nrun (--keep) started ${new Date().toISOString()}\n`);
else writeFileSync(logFile, `run started ${new Date().toISOString()}\n`);

// 1. Upstream checkout at the pinned commit, reset to pristine (node_modules and builds are ignored by git and stay).
if (!existsSync(join(up, ".git"))) {
  mkdirSync(up, { recursive: true });
  await run("git", ["init", "-q"]);
  await run("git", ["remote", "add", "origin", REPO]);
}
if (spawnSync("git", ["cat-file", "-e", `${SHA}^{commit}`], { cwd: up }).status !== 0) {
  await run("git", ["fetch", "-q", "--depth", "1", "origin", SHA]);
}
await run("git", ["checkout", "-q", "-f", "--detach", SHA]);
await run("git", ["clean", "-q", "-fd", "frameworks/keyed/frameact"]); // our copy from a previous run

// 2. frameact is not on npm: `pnpm pack` of src/ + package.json (the repo root would also pack docs, tests and
// bench dirs) and a copy of our framework dir next to the upstream ones. The lockfile is generated here — it
// holds the tarball's integrity hash, which changes with every pack, so it is never committed.
if (frameworks.includes("frameact")) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "pkg"), { recursive: true });
  for (const file of ["package.json", "LICENSE"]) cpSync(join(root, file), join(stage, "pkg", file));
  cpSync(join(root, "src"), join(stage, "pkg/src"), { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", stage], { cwd: join(stage, "pkg") });
  const target = join(up, "frameworks/keyed/frameact");
  rmSync(target, { recursive: true, force: true });
  cpSync(join(here, "frameworks/keyed/frameact"), target, { recursive: true });
  mkdirSync(join(target, "vendor"), { recursive: true });
  cpSync(join(stage, "frameact-0.0.0.tgz"), join(target, "vendor/frameact.tgz"));
}

// 3. Install and build only what is needed. `--ignore-scripts`: upstream's own advice for untrusted installs
// (and chromedriver's postinstall download is not needed by the default puppeteer runner).
await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(up, "server") });
await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(up, "webdriver-ts") });
await run("npm", ["run", "compile"], { cwd: join(up, "webdriver-ts") });
for (const f of frameworks) {
  const dir = join(up, "frameworks/keyed", f);
  if (!existsSync(join(dir, "package.json"))) fail(`${dir} has no package.json (upstream renamed or removed it?)`);
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
  // frameact's lockfile does not exist yet (generated), the others use upstream's.
  const install = f === "frameact" ? "install" : "ci";
  await run("npm", [install, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir });
  await run("npm", ["run", "build-prod"], { cwd: dir });
}

// 4. Upstream's server (serves frameworks/ and the shared css/) for the checks and the benchmark.
const probe = () =>
  fetch(`http://localhost:${PORT}/ls`).then(
    (r) => r.ok,
    () => false,
  );
if (await probe()) fail(`port ${PORT} is already serving something; stop it or set PORT=...`);
const server = spawn(join(up, "server/node_modules/.bin/tsx"), ["index.ts"], {
  cwd: join(up, "server"),
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid);
  } catch {}
};
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
for (let i = 0; i < 60 && !(await probe()); i++) await new Promise((r) => setTimeout(r, 500));
if (!(await probe())) fail("upstream server did not start");

// 5. Correctness, with upstream's own tooling (what `npm run rebuild-ci` runs): smoketest of every benchmark
// (headless playwright), isKeyed, CSP. frameact always; the others only with --check-all.
const wd = join(up, "webdriver-ts");
const env = { PORT: String(PORT), LANG: "en_US.UTF-8" };
const toCheck = keep ? [] : flag("--check-all") ? keyed : keyed.filter((f) => f === "keyed/frameact"); // --keep: a re-run, not a new verdict
const checks = [];
const keyedLines = [];
if (toCheck.length > 0) {
  const chrome = ["--chromeBinary", CHROME];
  // isKeyed and the CSP check select frameworks by positional arguments only (`--framework` is ignored there).
  const steps = [
    ["smoketest (all benchmarks, 1 iteration)", ["dist/benchmarkRunner.js", "--runner", "playwright", "--headless", "true", "--smoketest", "true", ...chrome, "--framework", ...toCheck]],
    ["isKeyed", ["dist/isKeyed.js", "--runner", "playwright", "--headless", "true", ...chrome, ...toCheck]],
    ["CSP", ["dist/isCSPCompliant.js", "--headless", "true", ...chrome, ...toCheck]],
  ];
  for (const [name, args] of steps) {
    const capture = [];
    const code = await run(process.execPath, args, { cwd: wd, env, quiet: true, allowFail: true, capture });
    const text = capture.join("");
    let ok = code === 0 && !/\bERROR\b/.test(text);
    if (name === "isKeyed") {
      // isKeyed swallows some exceptions into exit code 0: demand its positive verdict for every framework.
      const lines = text.split("\n").filter((l) => / is (non-)?keyed for 'run benchmark'/.test(l));
      keyedLines.push(...lines);
      ok &&= lines.length === toCheck.length && lines.every((l) => l.includes("It'll appear as keyed"));
    }
    checks.push({ name, ok });
    console.error(`${ok ? "✓" : "✗"} ${name}`);
  }
}
if (!keep) {
  writeFileSync(
    join(outDir, "correctness.json"),
    JSON.stringify({ upstream: SHA, checked: toCheck, checks, isKeyed: keyedLines }, null, 2) + "\n",
  );
}
if (checks.some((c) => !c.ok)) fail("correctness checks failed (see results/run.log) — no benchmark is run on a wrong implementation");

if (flag("--check")) {
  console.error("\n✓ checks passed (--check: benchmark skipped)");
  process.exit(0);
}

// 6. Idle machine? The numbers are only comparable within one run, but a loaded one is noisy: wait, then record.
const load = () => loadavg().map((n) => Number(n.toFixed(2)));
for (let waited = 0; loadavg()[0] > MAX_LOAD && waited < 10; waited++) {
  console.error(`load average ${load().join(" ")} > ${MAX_LOAD}: waiting 30 s (${waited + 1}/10)`);
  await new Promise((r) => setTimeout(r, 30_000));
}
const machine = {
  date: new Date().toISOString(),
  cpu: out("sysctl", ["-n", "machdep.cpu.brand_string"]) || cpus()[0]?.model,
  cores: cpus().length,
  memoryGB: Math.round(totalmem() / 2 ** 30),
  os: `${out("sw_vers", ["-productName"])} ${out("sw_vers", ["-productVersion"])}`.trim() || process.platform,
  node: process.version,
  chrome: out(CHROME, ["--version"]),
  upstream: SHA,
  headless,
  count: count ? Number(count) : null,
  frameworks,
  uptimeBefore: out("uptime", []),
  loadBefore: load(),
};

// 7. The benchmark: upstream defaults (puppeteer runner, 15 CPU iterations, CPU throttling for 03-06 and 09),
// in three passes so that a failure in one family does not lose the others.
if (!keep) rmSync(join(wd, "results"), { recursive: true, force: true });
const common = ["--framework", ...keyed, "--chromeBinary", CHROME, ...(headless ? ["--headless", "true"] : []), ...(count ? ["--count", count] : [])];
const passes = [
  ["CPU", ["01_", "02_", "03_", "04_", "05_", "06_", "07_", "08_", "09_"]],
  ["memory", ["21_", "22_", "25_"]],
  ["size", ["40_"]], // upstream no longer includes 30_startup (lighthouse) in its default benchmark set
];
const failed = [];
for (const [name, allIds] of passes) {
  const ids = onlyBenchmarks ? allIds.filter((id) => onlyBenchmarks.some((p) => id.startsWith(p))) : allIds;
  if (ids.length === 0) continue;
  console.error(`\n=== benchmark pass: ${name}`);
  const code = await run(process.execPath, ["dist/benchmarkRunner.js", ...common, "--benchmark", ...ids], {
    cwd: wd,
    env,
    allowFail: true,
  });
  if (code !== 0) failed.push(name);
}
machine.uptimeAfter = out("uptime", []);
machine.loadAfter = load();
machine.failedPasses = failed;

// 8. Results: raw JSON of webdriver-ts + machine info + report.
if (!keep) rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });
const resultsDir = join(wd, "results");
if (!existsSync(resultsDir) || readdirSync(resultsDir).length === 0) fail("webdriver-ts wrote no results");
cpSync(resultsDir, rawDir, { recursive: true });
const machineFile = join(outDir, "machine.json");
if (keep && existsSync(machineFile)) {
  // A partial re-run: the main run's machine info stays, the re-run is appended to it.
  const main = JSON.parse(readFileSync(machineFile, "utf8"));
  main.reruns = [...(main.reruns ?? []), { date: machine.date, frameworks, benchmarks: onlyBenchmarks ?? "all", loadBefore: machine.loadBefore, uptimeBefore: machine.uptimeBefore, failedPasses: failed }];
  writeFileSync(machineFile, JSON.stringify(main, null, 2) + "\n");
} else {
  writeFileSync(machineFile, JSON.stringify(machine, null, 2) + "\n");
}
await import("./report.mjs");
console.error(`\n${failed.length ? "! passes with errors: " + failed.join(", ") + "\n" : ""}✓ results in ${outDir}`);
process.exit(failed.length ? 2 : 0);
