#!/usr/bin/env node
// Runs js-reactivity-benchmark (pinned commit) with the frameact adapter added — no fork needed.
//
//   node bench/reactivity/run.mjs              checks + full benchmark → bench/reactivity/results/
//   node bench/reactivity/run.mjs --check      checks + frameact smoke run only
//   node bench/reactivity/run.mjs -- --framework frameact,solid --suite kairo   (args for upstream's runner)
//
// Steps: clone/fetch upstream at SHA into .upstream/ (git-ignored) → reset it → apply
// upstream.patch (registers the adapter, links frameact via `link:../../..`) → copy adapter.ts →
// pnpm install → upstream tests, typecheck, build, CLI checks, frameact smoke → benchmark → copy
// the report and chart into results/.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/transitive-bullshit/js-reactivity-benchmark";
const SHA = "2c273f164cea0d7eae9d383f4b9ab699e550109d";

const here = dirname(fileURLToPath(import.meta.url));
const up = join(here, ".upstream");
const outDir = join(here, "results");

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep === -1 ? argv : argv.slice(0, sep);
const passthrough = sep === -1 ? [] : argv.slice(sep + 1);
const checkOnly = own.includes("--check");

// Upstream pins pnpm 12 via `packageManager`; don't let a local pnpm try to download/switch to it.
const PNPM = ["--config.manage-package-manager-versions=false"];
const isWin = process.platform === "win32";

function run(cmd, args, opts = {}) {
  console.error(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: up, stdio: "inherit", shell: isWin && cmd === "pnpm", ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ failed (exit ${r.status ?? r.signal}): ${cmd} ${args.join(" ")}`);
    process.exit(r.status || 1);
  }
}
const git = (...args) => run("git", args);
const pnpm = (...args) => run("pnpm", [...PNPM, ...args]);
const node = (...args) => run(process.execPath, args);

// 1. Upstream checkout at the pinned commit, reset to pristine (node_modules kept for speed).
if (!existsSync(join(up, ".git"))) {
  mkdirSync(up, { recursive: true });
  git("init", "-q");
  git("remote", "add", "origin", REPO);
}
if (spawnSync("git", ["cat-file", "-e", `${SHA}^{commit}`], { cwd: up }).status !== 0) {
  git("fetch", "-q", "--depth", "1", "origin", SHA);
}
git("checkout", "-q", "-f", "--detach", SHA);
git("clean", "-q", "-fd"); // untracked, not ignored: our adapter copy from a previous run

// 2. Lockfile: upstream's pnpm 12 lockfile starts with an extra YAML document (packageManager
// pinning) that pnpm ≤ 11 does not understand — it would re-resolve every version. Drop that
// document so the engines are installed at exactly upstream's locked versions.
const lockPath = join(up, "pnpm-lock.yaml");
const lock = readFileSync(lockPath, "utf8");
if (lock.startsWith("---\n")) {
  const at = lock.indexOf("\n---\n", 4);
  if (at !== -1) writeFileSync(lockPath, lock.slice(at + 5));
}

// 3. Register the adapter and make frameact importable.
git("apply", "--whitespace=nowarn", join(here, "upstream.patch"));
copyFileSync(join(here, "adapter.ts"), join(up, "src/frameworks/frameact.ts"));
pnpm("install", "--no-frozen-lockfile");

// 4. Correctness: adapter contracts + graph oracle, typecheck (frameact sources included), the
// production build, upstream's CLI checks, and a production smoke run of every frameact suite.
pnpm("run", "test");
pnpm("run", "typecheck");
pnpm("run", "build");
node("scripts/check-cli.mjs");
run(
  process.execPath,
  ["--expose-gc", "dist/index.js", "--framework", "frameact", "--smoke", "--output", "results/frameact-smoke"],
  { stdio: ["inherit", "ignore", "inherit"] },
);

if (checkOnly) {
  console.error("\n✓ checks passed (--check: benchmark skipped)");
  process.exit(0);
}

// 5. The benchmark (default: every default engine, all suites). CSV on stdout is dropped; the
// runner writes JSON/CSV/Markdown itself.
run(process.execPath, ["--expose-gc", "dist/index.js", "--output", "results/run", ...passthrough], {
  stdio: ["inherit", "ignore", "inherit"],
});
mkdirSync(outDir, { recursive: true });
for (const ext of ["json", "csv", "md"]) {
  copyFileSync(join(up, `results/run.${ext}`), join(outDir, `latest.${ext}`));
}
const chart = spawnSync(process.execPath, ["scripts/generate-chart.mjs", "results/run.json", "results/run.svg"], {
  cwd: up,
  stdio: "inherit",
});
if (chart.status === 0) copyFileSync(join(up, "results/run.svg"), join(outDir, "latest.svg"));
else console.error("chart generation failed; report files were copied anyway");
console.error(`\n✓ results in ${outDir}`);
