// The headless-Chrome lane: `pnpm test:chrome`. Builds test/chrome (a dev build through the frameact
// Vite plugin), serves it with `vite preview`, dumps the DOM from headless Chrome and checks the
// results the page published in `data-result`. Needs Google Chrome (CHROME_BIN overrides the path);
// not part of `pnpm check` (jsdom covers the patch logic; this lane covers real layout and timing).
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build, preview } from 'vite';

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));
/** `data-result` is an HTML attribute: undo the serializer's escaping before parsing the JSON. */
const unescapeAttr = (html) => html.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 4178;

await build({ configFile });
const server = await preview({ configFile, preview: { port, strictPort: true } });
const profile = mkdtempSync(join(tmpdir(), 'frameact-chrome-'));
try {
  const { stdout } = await promisify(execFile)(
    chrome,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000', '--dump-dom', `http://localhost:${port}/`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
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
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
