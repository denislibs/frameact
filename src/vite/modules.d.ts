// Babel packages without bundled types.
declare module '@solidjs/babel-plugin' {
  import type { PluginItem } from '@babel/core';
  const plugin: PluginItem;
  export default plugin;
}
declare module '@babel/preset-typescript' {
  import type { PluginItem } from '@babel/core';
  const preset: PluginItem;
  export default preset;
}
