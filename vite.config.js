// The one build for every page the brain serves: admin (React), the wiring
// simulator and the phone, into dist/ at the paths server/pages.js names.
// `npm start` builds when stale; `npm run dev` runs this same config inside
// the brain (server/dev-pages.js).
//
// The phone's manifest and icons are copied as they are, not built: Vite
// would rename the manifest into assets/, where its start_url "./" and its
// icon paths no longer point at the phone's page. Its <link>s carry
// vite-ignore for the same reason.

import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import { PAGES } from './server/pages.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** @returns {import('vite').Plugin} */
function copyPhonePwa() {
  /** @type {string} */ let outDir;
  return {
    name: 'copy-phone-pwa',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    writeBundle() {
      cpSync(join(ROOT, 'phone', 'manifest.webmanifest'), join(outDir, 'phone', 'manifest.webmanifest'));
      cpSync(join(ROOT, 'phone', 'icons'), join(outDir, 'phone', 'icons'), { recursive: true });
    },
  };
}

export default defineConfig({
  root: ROOT,
  base: '/',
  publicDir: false,
  plugins: [react({ include: /admin\/.*\.[jt]sx?$/ }), copyPhonePwa()],
  build: {
    outDir: join(ROOT, 'dist'),
    emptyOutDir: true,
    // The phone's capture worklet is a 2 kB file loaded by URL; inlined, it
    // becomes a data: URL, which is not what audioWorklet.addModule has been
    // tried with on the phone. Scripts stay files.
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    rolldownOptions: { input: PAGES.map((p) => join(ROOT, p.html)) },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(ROOT)],
      // The recorded fixtures are a person's voice; the brain serves the two
      // synthesised check clips itself, at /fixtures/.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/core/fixtures/**'],
    },
  },
});
