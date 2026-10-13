import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `src/index.ts` re-exports the core modules: a core module that imports the barrel back is an
// import cycle (it works through live bindings, but breaks under bundling / tree-shaking changes).
it('no module under src/core imports the package barrel (src/index.ts)', () => {
  const dir = join(import.meta.dirname, '../../src/core');
  const offenders = readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => /from\s+['"]\.\.\/index['"]/.test(readFileSync(join(dir, file), 'utf8')));
  expect(offenders).toEqual([]);
});
