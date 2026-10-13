import frameact, { babelPlugins, compilerOptions, registerControlledBabelPlugin } from '../../src/vite/index';

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

it('warns in dev about destructured props: in the signature (function, arrow, function expression, typed) and in the body; not in prod', async () => {
  const code = [
    'function Chat({ isOpen }: P) { return <div>{isOpen}</div>; }',
    'const Panel = ({ title }) => <b>{title}</b>;',
    'const Row: FC<P> = function ({ id }) { return <i>{id}</i>; };',
    'export const Item = (props: P) => { const { id, title } = props; return <i>{id}</i>; };',
    'const ok = (props: P) => <i>{props.id}</i>;',
    'function helper({ a }) { return a; }', // lowercase: not a component
    'const fine = ({ a }) => a;',
  ].join('\n');
  const dev = await compile(code, '/app/x.tsx');
  expect(dev.warnings.length).toBe(4);
  expect(dev.warnings[0]).toContain('<Chat> destructures its props');
  expect(dev.warnings[1]).toContain('<Panel>');
  expect(dev.warnings[2]).toContain('<Row>');
  expect(dev.warnings[3]).toContain('const { … } = props');
  expect(dev.positions).toEqual([
    { line: 1, column: 0 },
    { line: 2, column: 0 },
    { line: 3, column: 0 },
    { line: 4, column: 36 },
  ]);
  expect((await compile(code, '/app/x.tsx', false)).warnings).toEqual([]);
});

describe('dev lint on pathological sources', () => {
  // The lints are regexes over the raw source: each must stay linear when the closing token is missing.
  const cases: Record<string, string> = {
    'unterminated type annotations': 'const A: x\n'.repeat(32_000),
    'unterminated destructuring': 'const {\n'.repeat(32_000),
    'tags without a closing >': '<input '.repeat(30_000),
    'intrinsic tags without a closing >': '<div '.repeat(30_000),
    'literal-looking values without a closing quote': '<input value={"'.repeat(30_000),
    'declarations without an =': 'declare const Cn: T;\n'.repeat(8_000),
  };
  for (const [name, code] of Object.entries(cases)) {
    it(`${name} (${Math.round(code.length / 1024)} KB) is linted in linear time`, async () => {
      const start = performance.now();
      await compile(code, '/app/x.tsx').catch(() => undefined); // invalid TSX: the compiler's error does not matter here
      expect(performance.now() - start).toBeLessThan(2000);
    });
  }

  it('thousands of findings are positioned in one pass', async () => {
    const code = 'function Cn({ a }) { return a; }\n'.repeat(40_000);
    const start = performance.now();
    const { warnings, positions } = await compile(code, '/app/x.tsx').catch(() => ({ warnings: [] as string[], positions: [] as Pos[] }));
    expect(performance.now() - start).toBeLessThan(2000);
    expect(warnings.length === 0 || positions[39_999]).toBeTruthy();
  });
});

describe('dev lint: destructuring props inside event handlers', () => {
  it('const { x } = props inside an on* handler is a fresh read at event time: no warning; in the component body it still warns', async () => {
    const handler = [
      'export const Row = (props: P) => (',
      '  <button onClick={() => { const { chatId } = props; open(chatId); }}>open</button>',
      ');',
    ].join('\n');
    expect((await compile(handler, '/app/x.tsx')).warnings).toEqual([]);
    const body = 'export const Row = (props: P) => { const { chatId } = props; return <i onClick={() => open(chatId)}>x</i>; };';
    const dev = await compile(body, '/app/x.tsx');
    expect(dev.warnings).toHaveLength(1);
    expect(dev.warnings[0]).toContain('event handler');
  });
});

it('registers the built-in controlled-input directives in modules whose JSX uses use:value / use:checked, before the module body', async () => {
  const withInput = await compile('const a = <input use:value={s} />;\nconst b = <input type="checkbox" use:checked={c} />;', '/app/x.jsx', false);
  const m = withInput.code.match(/^import \{ registerControlledDirectives as (\w+) \} from "frameact\/dom";\n\1\(\);$/m);
  expect(m).not.toBeNull();
  // the call precedes the first directive write of the module body (the compiler's hoisted imports and template declarations may come before it)
  expect(withInput.code.indexOf(`${m![1]}();`)).toBeLessThan(withInput.code.indexOf('_$setAttribute('));
  expect(withInput.code.match(/registerControlledDirectives/g)!.length).toBe(1);
  // a module without controlled inputs (even one mentioning value= or a user directive) is left alone
  const without = await compile('const a = <input value="x" use:focus={f} onInput={h} />;', '/app/y.jsx', false);
  expect(without.code).not.toContain('registerControlledDirectives');
});

const registered = (code: string) => /^import \{ registerControlledDirectives as (\w+) \} from ["']frameact\/dom["'];\s*\1\(\);/m.test(code);

async function transformPlain(code: string, id: string) {
  const plugin = frameact({ dev: false });
  const run = plugin.transform as unknown as (this: unknown, code: string, id: string) => Promise<{ code: string; map?: unknown } | null | undefined> | { code: string } | null | undefined;
  return (await run.call({ warn() {} }, code, id)) ?? null;
}

describe('controlled-input registration reaches every path that can write use:value / use:checked', () => {
  it('string keys in a JSX spread and in mergeProps are detected (no use:value= in the source)', async () => {
    const spread = await compile(`const a = <input {...{ "use:value": s }} />;`, '/app/x.jsx', false);
    expect(registered(spread.code)).toBe(true);
    const merged = await compile(
      `import { mergeProps } from 'frameact';\nexport const Field = (props) => { const p = mergeProps(props, { 'use:checked': c }); return <input type="checkbox" {...p} />; };`,
      '/app/field.jsx',
      false,
    );
    expect(registered(merged.code)).toBe(true);
    expect(merged.code.match(/registerControlledDirectives/g)!.length).toBe(1);
  });

  it('a .tsx helper that only builds the object (no JSX use:value=) registers too', async () => {
    const helper = await compile(`export const bind = (s: () => string) => ({ 'use:value': s }); const x = <div />;`, '/app/bind.tsx', false);
    expect(registered(helper.code)).toBe(true);
  });

  it('a comment or an unrelated string mentioning use:value= does not register', async () => {
    const quiet = await compile(`// <input use:value={s} />\nconst t = "use:value=";\nconst a = <input value="x" />;`, '/app/y.jsx', false);
    expect(quiet.code).not.toContain('registerControlledDirectives');
  });

  it('asset queries (?raw, ?url, ?inline) are not compiled', async () => {
    for (const q of ['?raw', '?url', '?inline', '?v=1&raw']) {
      expect((await compile('export default "<input use:value={s} />";', `/app/x.jsx${q}`)).code).toBe('');
    }
  });

  describe('modules outside the JSX pipeline (pre-compiled libraries, plain .js/.ts helpers)', () => {
    const library = 'import { setAttribute } from "frameact/dom";\nexport function bind(el, s) { setAttribute(el, "use:value", s); }\n';

    it('injects the registration into an ESM module in node_modules that mentions "use:value" / "use:checked"', async () => {
      const out = await transformPlain(library, '/app/node_modules/ui-kit/dist/input.js');
      expect(out).not.toBeNull();
      expect(registered(out!.code)).toBe(true);
      // line structure is kept (the injection stays on line 1), so the module's own source map stays valid
      expect(out!.code.split('\n').length).toBe(library.split('\n').length);
      expect(out!.code.endsWith(library)).toBe(true);
      for (const [file, text] of [
        ['a.mjs', library],
        ['b.ts', library.replace('use:value', 'use:checked')],
        ['c.cjs', "export const k = 'use:value';"],
      ] as const) {
        expect(registered((await transformPlain(text, `/app/node_modules/ui-kit/${file}`))!.code)).toBe(true);
      }
    });

    it('leaves alone: modules without the literal, CommonJS, already-registering modules, virtual modules and asset queries', async () => {
      expect(await transformPlain('export const a = "use:focus"; export const b = "xuse:value";', '/app/node_modules/k/a.js')).toBeNull();
      expect(await transformPlain('module.exports = { k: "use:value" };', '/app/node_modules/k/cjs.js')).toBeNull();
      expect(await transformPlain(`import { registerControlledDirectives } from "frameact/dom";\nregisterControlledDirectives();\n${library}`, '/app/node_modules/k/b.js')).toBeNull();
      expect(await transformPlain(library, '\0virtual:lib.js')).toBeNull();
      for (const q of ['?raw', '?url', '?inline', '?worker']) expect(await transformPlain(library, `/app/node_modules/k/a.js${q}`)).toBeNull();
      expect(await transformPlain(library, '/app/node_modules/k/data.json')).toBeNull();
      expect(await transformPlain(library, '/app/node_modules/k/style.css')).toBeNull();
    });

    it('frameact\'s own sources never carry the quoted names (they would register the directives in every app)', async () => {
      const { readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
      const offenders = walk('src')
        .filter((f) => /\.[cm]?[jt]s$/.test(f) && !f.endsWith('.d.ts'))
        .filter((f) => /(["'])use:(?:value|checked)\1/.test(readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  });

  describe('Babel plugin for non-Vite pipelines', () => {
    it('babelPlugins(dev) compiles JSX and registers; registerControlledBabelPlugin alone registers a plain module that sets the string key', async () => {
      const { transformAsync } = await import('@babel/core');
      const both = await transformAsync(`const a = <input {...{ 'use:value': s }} />;`, {
        filename: '/lib/x.jsx',
        babelrc: false,
        configFile: false,
        plugins: babelPlugins(false),
      });
      expect(both!.code).toContain('_$template');
      expect(registered(both!.code!)).toBe(true);
      const plain = await transformAsync(`import { setAttribute } from "frameact/dom";\nsetAttribute(el, "use:checked", c);`, {
        filename: '/lib/y.js',
        babelrc: false,
        configFile: false,
        plugins: [registerControlledBabelPlugin],
      });
      expect(registered(plain!.code!)).toBe(true);
      const none = await transformAsync(`export const a = 1;`, { filename: '/lib/z.js', babelrc: false, configFile: false, plugins: [registerControlledBabelPlugin] });
      expect(none!.code).not.toContain('registerControlledDirectives');
      // idempotent: a module that already imports and calls it is not registered twice
      const twice = await transformAsync(`import { registerControlledDirectives as r } from "frameact/dom";\nr();\nsetAttribute(el, "use:value", s);`, {
        filename: '/lib/w.js',
        babelrc: false,
        configFile: false,
        plugins: [registerControlledBabelPlugin],
      });
      expect(twice!.code!.match(/registerControlledDirectives/g)!.length).toBe(1);
    });
  });
});
