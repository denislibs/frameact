// The headless-Chrome lane: `pnpm test:chrome`. Builds test/chrome (a dev build through the frameact
// Vite plugin), serves it with `vite preview`, dumps the DOM from headless Chrome and checks the
// results the page published in `data-result`. Needs Google Chrome (CHROME_BIN overrides the path);
// not part of `pnpm check` (jsdom covers the patch logic; this lane covers real layout and timing).
// Hardening: Chrome is killed after CHROME_TIMEOUT_MS (default 60 s) — a hung browser must not hang the lane —
// the preview server and the throw-away profile are cleaned up on SIGINT/SIGTERM too, the server listens on
// 127.0.0.1 only, and Chrome is started without background network traffic (component updates, sync).
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));
/** `data-result` is an HTML attribute: undo the serializer's escaping before parsing the JSON. */
const unescapeAttr = (html) => html.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const timeout = Number(process.env.CHROME_TIMEOUT_MS) || 60_000;
const host = '127.0.0.1';
const port = 4178;

/** Run Chrome; resolves with its stdout. Kills it (SIGKILL) on timeout. */
function dumpDom(profile, onChild) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      chrome,
      [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
        '--virtual-time-budget=10000', '--dump-dom', `http://${host}:${port}/`,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error?.killed) reject(new Error(`Chrome did not finish within ${timeout} ms and was killed`));
        else if (error) reject(error);
        else resolve(stdout);
      },
    );
    onChild(child);
  });
}

await build({ configFile });
const server = await preview({ configFile, preview: { host, port, strictPort: true } });
const profile = mkdtempSync(join(tmpdir(), 'frameact-chrome-'));
let child;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  child?.kill('SIGKILL');
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    cleanup().finally(() => process.exit(code));
  });
}

try {
  const stdout = await dumpDom(profile, (c) => { child = c; });
  const match = /data-result="([^"]*)"/.exec(stdout);
  if (!match) {
    console.error('no data-result in the dumped DOM (the page did not finish):\n' + stdout.slice(0, 2000));
    process.exitCode = 1;
  } else {
    const results = JSON.parse(unescapeAttr(match[1]));
    let failed = 0;
    for (const { name, ok, detail } of results) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
      if (!ok) failed++;
    }
    console.log(`${results.length - failed}/${results.length} scenarios passed`);
    if (failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
