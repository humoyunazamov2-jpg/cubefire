import { defineConfig } from 'vite';

// Relative asset paths, so the same build works at any address: GitHub Pages
// (/cubefire/), another host's root, or `vite preview` on this computer.
export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
