import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap } from '../../tools/roadmap.js';

const text = `# Roadmap

- [ ] **1.** A3 hardware record — ready: needs the board
  - done when: the panel is lit and the record exists

- [ ] **2.** A4 setup card — blocked: needs 1
- [x] **3.** Something finished — done
`;

test('parses number, title and status, and keeps the acceptance lines', () => {
  const items = parseRoadmap(text);
  assert.equal(items.length, 3);
  assert.equal(items[0].number, 1);
  assert.equal(items[0].status, 'ready');
  assert.match(items[0].body, /done when/);
  assert.equal(items[1].status, 'blocked');
  assert.equal(items[2].status, 'done');
});

test('refuses a line without a state, so a vague item cannot be picked up', () => {
  assert.throws(() => parseRoadmap('- [ ] **4.** no state here\n'), /state/);
});

test('the shape example inside a fenced block is not an item', () => {
  const withFence = `# Roadmap\n\n\`\`\`\n- [ ] **N.** 标题 — state\n\`\`\`\n\n- [ ] **1.** real — ready\n`;
  const items = parseRoadmap(withFence);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'real');
});
