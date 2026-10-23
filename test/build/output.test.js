import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { PAGES } from '../../server/pages.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('the build puts every page, the PWA files and the worklet where the brain looks', { timeout: 120_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'dist-'));
  await build({ configFile: join(ROOT, 'vite.config.js'), build: { outDir: out }, logLevel: 'silent' });

  for (const p of PAGES) assert.ok(existsSync(join(out, p.html)), p.html);

  // Byte for byte: Vite would rename it into assets/, where start_url "./"
  // and the icon paths no longer point at the phone's page.
  const manifest = readFileSync(join(out, 'phone', 'manifest.webmanifest'), 'utf8');
  assert.equal(manifest, readFileSync(join(ROOT, 'phone', 'manifest.webmanifest'), 'utf8'));
  for (const icon of JSON.parse(manifest).icons) assert.ok(existsSync(join(out, 'phone', icon.src)), icon.src);
  assert.match(readFileSync(join(out, 'phone', 'index.html'), 'utf8'), /href="manifest\.webmanifest"/);

  assert.doesNotMatch(readFileSync(join(out, 'sim', 'index.html'), 'utf8'), /importmap/);

  const assets = readdirSync(join(out, 'assets'));
  const worklet = assets.find((f) => readFileSync(join(out, 'assets', f), 'utf8').includes('registerProcessor'));
  assert.ok(worklet, 'the capture worklet is in assets/');
  assert.ok(assets.some((f) => f.endsWith('.js') && f !== worklet
    && readFileSync(join(out, 'assets', f), 'utf8').includes(worklet)), 'the phone code names the worklet file');
});
