import { defineConfig } from 'vite';

// GitHub Pages serves the site from /cubefire/, local dev from /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cubefire/' : '/',
  server: { port: 5174, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
}));
