import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron loads the production page through file://, so assets must be
  // relative to dist/index.html rather than rooted at /assets.
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.VITE_PORT || 5317), strictPort: true }
});
