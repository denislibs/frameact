import frameact, { compilerOptions } from '../../src/vite/index';

type Pos = { line: number; column: number } | number | undefined;

async function compile(code: string, id: string, dev = true, options: Parameters<typeof frameact>[0] = {}) {
  const plugin = frameact({ dev, ...options });
  const warnings: string[] = [];
  const positions: Pos[] = [];
  const ctx = {
    warn: (message: string | { message: string }, pos?: Pos) => {
      warnings.push(typeof message === 'string' ? message : message.message);
      positions.push(pos);
    },
  };
  const transform = plugin.transform as unknown as (
    this: typeof ctx,
    code: string,
    id: string,
  ) => Promise<{ code: string; map?: unknown } | null>;
  const result = await transform.call(ctx, code, id);
  return { code: result?.code ?? '', map: result?.map, warnings, positions };
}

const source = [
  'type P = { n: number };',
  "export const App = (props: P) => <div class={props.n > 1 ? 'big' : 'small'}><Child /></div>;",
  'const Child = () => <span>hi</span>;',
].join('\n');

it('compiles TSX to frameact/dom calls; dev output carries component and binding names, prod does not', async () => {
  const dev = await compile(source, '/app/App.tsx');
  expect(dev.code).toContain('from "frameact/dom"');
  expect(dev.code).toContain('"Child")');
  expect(dev.code).toContain('name: "div.class"');
  expect(dev.code).not.toContain('type P');
  // the static template string (`_$template(`<div>`)`) legitimately contains "<div>"; only inlined markup would have "<div class="
  expect(dev.code).not.toContain('<div class=');
  const prod = await compile(source, '/app/App.tsx', false);
  expect(prod.code).toContain('from "frameact/dom"');
  expect(prod.code).not.toContain('"Child")');
  expect(prod.code).not.toContain('name:');
});

it('leaves non-JSX files and node_modules alone', async () => {
  expect((await compile('const a = 1;', '/app/a.ts')).code).toBe('');
  expect((await compile('const a = <b/>;', '/app/node_modules/x/a.jsx')).code).toBe('');
  expect((await compile('const a = <b/>;', '/app/x.jsx?v=1')).code).toContain('_$template');
});

it('warns in dev about reactive value=/checked= on inputs (use use:value); not in prod', async () => {
  const code = 'const a = <input value={s()} />; const b = <input type="checkbox" checked={c()} />; const ok = <input use:value={s} />;';
  const dev = await compile(code, '/app/x.jsx');
  expect(dev.warnings.length).toBe(2);
  expect(dev.warnings[0]).toContain('use:value');
  expect(dev.warnings[1]).toContain('use:checked');
  expect((await compile(code, '/app/x.jsx', false)).warnings).toEqual([]);
});

it('the lint scan steps over => inside earlier attribute expressions', async () => {
  const arrow = await compile('const a = <input onInput={e => s(e.currentTarget.value)} value={v()} />;', '/app/x.jsx');
  expect(arrow.warnings.length).toBe(1);
  expect(arrow.warnings[0]).toContain('use:value');
});

it('compilerOptions pins the compiler contract', () => {
  expect(compilerOptions(true)).toEqual({
    moduleName: 'frameact/dom',
    generate: 'dom',
    hydratable: false,
    delegateEvents: true,
    builtIns: ['For', 'Show', 'Switch', 'Match', 'Portal', 'Dynamic'],
    dev: true,
    sourceNames: true,
    requireImportSource: false,
  });
});

it('lint warnings carry the line and column of the offending tag', async () => {
  const code = 'const a = 1;\nconst b = (\n  <input value={s()} />\n);';
  const { positions } = await compile(code, '/app/x.jsx');
  expect(positions).toEqual([{ line: 3, column: 2 }]);
});

it('lint scan: literal value=/checked= are skipped; a constant identifier is a documented false positive; a bare > is a documented false negative', async () => {
  const literals = await compile(
    `const a = [<input value={"x"} />, <input value={'y'} />, <input value={3} />, <input checked={true} />, <input checked={false} />, <input value={null} />];`,
    '/app/x.jsx',
  );
  expect(literals.warnings).toEqual([]);
  // false positive: the compiler inlines a constant, but the lint cannot tell it from a signal read
  const constant = await compile('const L = "x"; const a = <input value={L} />;', '/app/x.jsx');
  expect(constant.warnings.length).toBe(1);
  // false negative: a bare `>` in an earlier attribute expression ends the opening-tag scan early
  const bare = await compile('const a = <input disabled={n() > 1} value={v()} />;', '/app/x.jsx');
  expect(bare.warnings).toEqual([]);
});

it('warns in dev about static string on* attributes (inlined into the template, bypassing the runtime check)', async () => {
  const code = 'const a = <div onclick="alert(1)" />; const b = <p onClick=\'x\'>t</p>; const ok = <div onClick={f} />; const c = <Button onClick="x" />;';
  const dev = await compile(code, '/app/x.jsx');
  expect(dev.warnings.length).toBe(2);
  expect(dev.warnings[0]).toContain('onclick="…"');
  expect(dev.warnings[1]).toContain('onClick="…"');
  expect((await compile(code, '/app/x.jsx', false)).warnings).toEqual([]);
});

it('skips virtual modules; a custom exclude replaces the node_modules default', async () => {
  expect((await compile('const a = <b/>;', '\0virtual:x.tsx')).code).toBe('');
  const own = { exclude: /legacy/ };
  expect((await compile('const a = <b/>;', '/app/legacy/a.jsx', true, own)).code).toBe('');
  expect((await compile('const a = <b/>;', '/app/node_modules/x/a.jsx', true, own)).code).toContain('_$template');
});

it('returns a source map', async () => {
  const { map } = await compile(source, '/app/App.tsx');
  expect(map).toBeTruthy();
  expect((map as { mappings: string }).mappings.length).toBeGreaterThan(0);
});

async function compileResolved(options: { dev?: boolean }, isProduction: boolean) {
  const plugin = frameact(options);
  (plugin.configResolved as unknown as (config: { isProduction: boolean }) => void)({ isProduction });
  const warnings: string[] = [];
  const transform = plugin.transform as unknown as (
    this: { warn(m: string): void },
    c: string,
    i: string,
  ) => Promise<{ code: string }>;
  const result = await transform.call(
    { warn: (message) => warnings.push(message) },
    source + '\nconst i = <input value={s()} />;',
    '/app/App.tsx',
  );
  return { named: result.code.includes('name:'), warned: warnings.length };
}

it('derives dev from the resolved config when the option is omitted; the option wins', async () => {
  expect(await compileResolved({}, true)).toEqual({ named: false, warned: 0 });
  expect(await compileResolved({}, false)).toEqual({ named: true, warned: 1 });
  expect(await compileResolved({ dev: true }, true)).toEqual({ named: true, warned: 1 });
});
