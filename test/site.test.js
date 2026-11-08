import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/beasaltfish/bot-reborn';
const PAGES = {
  en: { file: 'site/index.html', stations: ['Simulate', 'Build', 'Configure', 'Run'], other: 'zh' },
  zh: { file: 'site/zh/index.html', stations: ['模拟', '搭建', '配置', '运行'], other: 'en' },
};
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');

for (const [lang, p] of Object.entries(PAGES)) {
  const html = () => read(p.file);

  test(`${lang}: three Star links, all pointing at the repo`, () => {
    const stars = [...html().matchAll(/<a\b[^>]*class="[^"]*\bstar\b[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.equal(stars.length, 3);
    for (const tag of stars) assert.ok(tag.includes(`href="${REPO}"`), tag);
  });

  test(`${lang}: no star count and no status badges`, () => {
    const text = strip(html());
    assert.doesNotMatch(text, /\b\d+(\.\d+)?k?\s*stars?\b/i);
    assert.doesNotMatch(html(), /class="[^"]*badge/);
    assert.doesNotMatch(text, /coming|in progress/i);
  });

  test(`${lang}: four stations in order`, () => {
    const block = html().match(/<div class="stations">([\s\S]*?)<\/div>\s*<div class="term"/);
    assert.ok(block, 'stations block missing');
    const heads = [...block[1].matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1].trim());
    assert.deepEqual(heads, p.stations);
  });

  test(`${lang}: links to the other language with hreflang`, () => {
    assert.match(html(), new RegExp(`<a\\b[^>]*hreflang="${p.other}"`));
  });

  test(`${lang}: local references resolve`, () => {
    const base = dirname(resolve(root, p.file));
    const refs = [...html().matchAll(/\b(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:|#|mailto:)/.test(ref)) continue;
      const clean = ref.split('#')[0];
      const target = clean.startsWith('/') ? resolve(root, 'site', '.' + clean) : resolve(base, clean);
      const isDir = clean.endsWith('/');
      // media/hero.mp4 is produced by the separate video plan
      if (clean.endsWith('hero.mp4')) continue;
      assert.ok(existsSync(isDir ? resolve(target, 'index.html') : target), `missing: ${ref}`);
    }
  });

  test(`${lang}: install commands match the README`, () => {
    const readme = read('README.md');
    const term = html().match(/<div class="term">([\s\S]*?)<\/div>/);
    assert.ok(term, 'terminal block missing');
    const lines = strip(term[1].replace(/<br\s*\/?>/g, '\n'))
      .split('\n').map((l) => l.replace(/^[\s$]+/, '').trim()).filter(Boolean);
    assert.ok(lines.length >= 3);
    for (const line of lines) if (!line.startsWith('→')) assert.ok(readme.includes(line), `not in README: ${line}`);
  });

  test(`${lang}: hero video is cheap and poster-backed`, () => {
    const v = html().match(/<video\b[^>]*>/);
    assert.ok(v, 'video missing');
    for (const needle of ['muted', 'loop', 'playsinline', 'preload="metadata"', 'poster=', 'aspect-ratio']) {
      assert.ok(v[0].includes(needle), `video lacks ${needle}`);
    }
    assert.doesNotMatch(html(), /\.gif|youtube/i);
  });

  test(`${lang}: autoplay respects data saver and small screens`, () => {
    const script = (html().match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
    assert.ok(script.includes('saveData'));
    assert.ok(script.includes('matchMedia'));
  });
}

test('en and zh have the same section ids in the same order', () => {
  const ids = (f) => [...read(f).matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(PAGES.en.file), ['workbench', 'story', 'why', 'final']);
  assert.deepEqual(ids(PAGES.zh.file), ids(PAGES.en.file));
});

test('stylesheet is responsive and self-hosts its fonts', () => {
  const css = read('site/style.css');
  assert.match(css, /@media \(max-width/);
  assert.equal((css.match(/@font-face/g) || []).length, 3);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
});
