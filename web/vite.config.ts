import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/files': SERVER,
      '/samples': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
  // The splat library ships workers/wasm; don't let esbuild pre-bundle them.
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
});
