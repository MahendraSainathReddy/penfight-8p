import { defineConfig } from 'vite';

export default defineConfig({
  base: '/penfight-8p/',
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
