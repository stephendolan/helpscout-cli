import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  shims: false,
  outDir: 'dist',
  dts: false,
  sourcemap: true,
  minify: false,
  define: {
    __VERSION__: JSON.stringify(packageJson.version),
    __HOMEPAGE__: JSON.stringify(packageJson.homepage ?? ''),
  },
});
