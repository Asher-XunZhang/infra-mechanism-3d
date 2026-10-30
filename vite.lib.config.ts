import { defineConfig } from 'vite';

export default defineConfig({
  // The embed is loaded directly by static sites without a Node process global.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    outDir: 'dist/embed',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: {
        'infra-mechanism-viewer': 'src/lib/index.ts',
        'sglang-viewer': 'src/lib/sglang.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: 'infra-mechanism-viewer.[ext]',
      },
    },
  },
});
