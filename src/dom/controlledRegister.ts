// `import 'frameact/dom/controlled'` — the side-effect form of registerControlledDirectives(), for an app or
// library that writes `use:value` / `use:checked` where neither the Vite plugin nor the Babel plugin sees it.
// Importing it bundles the controlled-input machinery; leave it out of apps without controlled inputs.
import { registerControlledDirectives } from './controlled';

registerControlledDirectives();
