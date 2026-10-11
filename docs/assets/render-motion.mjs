// Captures frames of social-preview-b-motion.html via Chrome DevTools Protocol.
// usage: node render-motion.mjs <html> <outdir> [fps] [duration] [scale]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [html, out, fpsArg = '20', durArg = '6.5', scaleArg = '1'] = process.argv.slice(2);
const fps = +fpsArg, dur = +durArg, scale = +scaleArg, port = 9333;
mkdirSync(out, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--user-data-dir=' + resolve(out, '.profile'),
   '--window-size=1280,640', `--force-device-scale-factor=${scale}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://localhost:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: scale, mobile: false });
await send('Page.navigate', { url: 'file://' + resolve(html) });
await sleep(1500);
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>1)', awaitPromise: true });
await sleep(300);
const n = Math.round(fps * dur);
for (let f = 0; f < n; f++) {
  const t = (f / fps) * 1000;
  await send('Runtime.evaluate', { expression: `document.getAnimations().forEach(a=>{a.pause();a.currentTime=${t}});1` });
  await sleep(30);
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(out, `f${String(f).padStart(4, '0')}.png`), Buffer.from(result.data, 'base64'));
  if (f % 20 === 0) console.log(`frame ${f}/${n}`);
}
ws.close(); chrome.kill(); console.log('done', n, 'frames');
