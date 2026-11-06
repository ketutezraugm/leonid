import { defineConfig } from 'tsup';

// One file that Render's Workflow service runs with node. @renderinc/sdk stays external: it is installed by the build.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
});
