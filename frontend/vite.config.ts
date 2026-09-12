import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the sandboxed live-preview host
    allowedHosts: true,
    // Browser-facing code uses relative /env URLs; dev server proxies to the
    // Python environmental data API.
    proxy: {
      '/env': { target: 'http://localhost:8100', changeOrigin: true },
      '/ml': { target: 'http://localhost:8100', changeOrigin: true },
      // Node application API (orchestration layer)
      '/api': { target: 'http://localhost:8200', changeOrigin: true },
    },
  },
  // `vite preview` serves the production build (dist/) with the same
  // proxying — this is the demo/production serving mode.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/env': { target: 'http://localhost:8100', changeOrigin: true },
      '/ml': { target: 'http://localhost:8100', changeOrigin: true },
      '/api': { target: 'http://localhost:8200', changeOrigin: true },
    },
  },
});
