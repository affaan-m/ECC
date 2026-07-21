import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built app works whether it is served from a domain
// root or a sub-path (e.g. GitHub Pages project pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
