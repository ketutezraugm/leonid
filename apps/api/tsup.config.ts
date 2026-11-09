import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Workspace packages ship TS source, so bundle them into the output.
  noExternal: [/^@leonid\//],
});
