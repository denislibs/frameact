import { defineConfig } from "vite";
import frameact from "frameact/vite";

export default defineConfig({
  plugins: [frameact({ dev: false })],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/main.jsx",
      output: { format: "iife", entryFileNames: "main.js" },
    },
  },
});
