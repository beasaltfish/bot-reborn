// The tarot deck and the draw (tarot mode spec §4, §6). Pure data and pure
// functions: nothing here knows about screens, the brain or the clock.
//
// Every card's two meanings are PLACEHOLDERS for now. The real entries are
// short keyword lines condensed from Waite's public-domain "The Pictorial Key
// to the Tarot" (1910); fetching that text needs the user's approval, so the
// whole path is built and tested on these. Swapping them is a change to the
// `MEANINGS` table below and nothing else.

/** @typedef {'wands' | 'cups' | 'swords' | 'pentacles'} Suit */
/**
 * @typedef {{
 *   id: string, en: string, zh: string,
 *   arcana: 'major' | 'minor', suit: Suit | null,
 *   upright: string, reversed: string,
 * }} Card
 * @typedef {{ id: string, reversed: boolean }} Draw
 */

/** The 22 major arcana, in order. [English, Chinese]. */
const MAJOR = [
  ['The Fool', '愚者'], ['The Magician', '魔术师'], ['The High Priestess', '女祭司'],
  ['The Empress', '皇后'], ['The Emperor', '皇帝'], ['The Hierophant', '教皇'],
  ['The Lovers', '恋人'], ['The Chariot', '战车'], ['Strength', '力量'],
  ['The Hermit', '隐者'], ['Wheel of Fortune', '命运之轮'], ['Justice', '正义'],
  ['The Hanged Man', '倒吊人'], ['Death', '死神'], ['Temperance', '节制'],
  ['The Devil', '恶魔'], ['The Tower', '高塔'], ['The Star', '星星'],
  ['The Moon', '月亮'], ['The Sun', '太阳'], ['Judgement', '审判'], ['The World', '世界'],
];

/** The four suits: id stem, English, Chinese. */
const SUITS = /** @type {const} */ ([
  ['wands', 'Wands', '权杖'], ['cups', 'Cups', '圣杯'],
  ['swords', 'Swords', '宝剑'], ['pentacles', 'Pentacles', '星币'],
]);

/** Ace to ten, then the four court cards. [English, Chinese]. */
const RANKS = [
  ['Ace', '王牌'], ['Two', '二'], ['Three', '三'], ['Four', '四'], ['Five', '五'],
  ['Six', '六'], ['Seven', '七'], ['Eight', '八'], ['Nine', '九'], ['Ten', '十'],
  ['Page', '侍从'], ['Knight', '骑士'], ['Queen', '王后'], ['King', '国王'],
];

/**
 * PLACEHOLDER meanings. The one place to replace them (see the file header):
 * the real version looks each card up in the condensed Waite table.
 * @param {string} en
 * @returns {{ upright: string, reversed: string }}
 */
const MEANINGS = (en) => ({
  upright: `placeholder: the upright meaning of ${en}`,
  reversed: `placeholder: the reversed meaning of ${en}`,
});

/** @type {Card[]} */
const cards = [];
MAJOR.forEach(([en, zh], i) => {
  cards.push({ id: `major-${String(i).padStart(2, '0')}`, en, zh, arcana: 'major', suit: null, ...MEANINGS(en) });
});
for (const [stem, suitEn, suitZh] of SUITS) {
  RANKS.forEach(([rankEn, rankZh], i) => {
    const en = `${rankEn} of ${suitEn}`;
    cards.push({
      id: `${stem}-${String(i + 1).padStart(2, '0')}`,
      en, zh: `${suitZh}${rankZh}`, arcana: 'minor', suit: stem, ...MEANINGS(en),
    });
  });
}

export const TAROT_CARDS = /** @type {readonly Card[]} */ (cards);

/** @param {string} id @returns {Card | undefined} */
export function cardById(id) {
  return TAROT_CARDS.find((c) => c.id === id);
}

/**
 * One random card, and whether it came up reversed. A new draw every call: no
 * daily lock and no memory (spec §4). `rng` is injectable so a test can fix it.
 * @param {() => number} [rng] 0 up to but not including 1
 * @returns {Draw}
 */
export function drawRandom(rng = Math.random) {
  const index = Math.min(TAROT_CARDS.length - 1, Math.floor(rng() * TAROT_CARDS.length));
  return { id: TAROT_CARDS[index].id, reversed: rng() >= 0.5 };
}

/**
 * What the AI is handed for a draw: the names, which way up, and that
 * orientation's entry. Only that: the model reads the card from this, never
 * from what the picture shows.
 * @param {Draw} draw
 * @returns {string}
 */
export function describeDraw(draw) {
  const card = cardById(draw.id);
  if (!card) return `Unknown card ${draw.id}.`;
  const way = draw.reversed ? 'reversed' : 'upright';
  return `Card drawn: ${card.en} (${card.zh}), ${way}. Meaning: ${draw.reversed ? card.reversed : card.upright}`;
}
