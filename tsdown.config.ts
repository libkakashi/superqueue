import {defineConfig} from 'tsdown';

export default defineConfig({
  entry: 'src/**/*.ts',
  outDir: 'build',
  dts: true,
  clean: true,
  platform: 'neutral',
  format: ['esm', 'cjs'],
});
