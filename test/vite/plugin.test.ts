import frameact, { compilerOptions } from '../../src/vite/index';

async function compile(code: string, id: string, dev = true) {
  const plugin = frameact({ dev });
  const warnings: string[] = [];
  const ctx = {
    warn: (message: string | { message: string }) => {
      warnings.push(typeof message === 'string' ? message : message.message);
    },
  };
  const transform = plugin.transform as unknown as (
    this: typeof ctx,
    code: string,
    id: string,
  ) => Promise<{ code: string } | null>;
  const result = await transform.call(ctx, code, id);
  return { code: result?.code ?? '', warnings };
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
