import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    // inspect.html (asset inspector) is a dev-only tool: not part of the build.
    chunkSizeWarningLimit: 5000, // Rapier's WASM is embedded in the bundle
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
