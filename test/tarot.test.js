import test from 'node:test';
import assert from 'node:assert/strict';

import { TAROT_CARDS, drawRandom, cardById, describeDraw } from '../core/tarot.js';

/** A small deterministic rng (LCG) so the sweeps are reproducible. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('the deck has 78 unique cards: 22 major, 14 of each suit', () => {
  assert.equal(TAROT_CARDS.length, 78);
  assert.equal(new Set(TAROT_CARDS.map((c) => c.id)).size, 78);
  assert.equal(TAROT_CARDS.filter((c) => c.arcana === 'major').length, 22);
  for (const suit of ['wands', 'cups', 'swords', 'pentacles']) {
    assert.equal(TAROT_CARDS.filter((c) => c.arcana === 'minor' && c.suit === suit).length, 14, suit);
  }
  assert.ok(TAROT_CARDS.filter((c) => c.arcana === 'major').every((c) => c.suit === null));
  for (const c of TAROT_CARDS) {
    for (const f of /** @type {const} */ (['en', 'zh', 'upright', 'reversed'])) assert.ok(c[f] && c[f].length > 0, `${c.id} ${f}`);
  }
});

test('a fixed rng gives a fixed draw', () => {
  assert.deepEqual(drawRandom(() => 0), { id: TAROT_CARDS[0].id, reversed: false });
  assert.equal(drawRandom(() => 0.999999).id, TAROT_CARDS[77].id);
  assert.equal(drawRandom(() => 0.999999).reversed, true);
});

test('an rng swept over 0..1 reaches every card, and reversed about half the time', () => {
  const rng = seeded(7);
  const seen = new Set();
  let reversed = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const d = drawRandom(rng);
    seen.add(d.id);
    if (d.reversed) reversed++;
  }
  assert.equal(seen.size, 78);
  const share = reversed / N;
  assert.ok(share > 0.45 && share < 0.55, `reversed share was ${share}`);
});

test('successive draws are independent: the draw has no memory of earlier ones', () => {
  assert.deepEqual(drawRandom(() => 0.3), drawRandom(() => 0.3));
  const rng = seeded(3);
  const a = drawRandom(rng);
  const b = drawRandom(rng);
  assert.notDeepEqual(a, b);
});

test('cardById finds a card and nothing else', () => {
  assert.equal(cardById(TAROT_CARDS[5].id), TAROT_CARDS[5]);
  assert.equal(cardById('no-such-card'), undefined);
});

test('describeDraw names the card in both languages and carries only the chosen orientation', () => {
  const card = TAROT_CARDS[0];
  const down = describeDraw({ id: card.id, reversed: true });
  for (const part of [card.en, card.zh, 'reversed', card.reversed]) assert.ok(down.includes(part), part);
  assert.ok(!down.includes(card.upright));
  const up = describeDraw({ id: card.id, reversed: false });
  assert.ok(up.includes(card.upright) && up.includes('upright'));
  assert.ok(!up.includes(card.reversed));
});
