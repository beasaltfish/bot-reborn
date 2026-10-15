// The admin page: built into admin/dist and served by the brain (admin spec
// §2). In development `npm run admin:dev` serves it with hot reload and sends
// /api and /fixtures on to a brain running on 8787.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // The page imports core/ (provider list, checks) from outside its root.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:8787', '/fixtures': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
