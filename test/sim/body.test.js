import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeUplink, shapeDownlink, characterChoices, chooseCharacter, chooseLine, faultText, adminLink, keepsFault } from '../../sim/body.js';

const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
const bytesOf = (/** @type {Int16Array} */ a) => /** @type {ArrayBuffer} */ (a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

test('uplink: ok passes the samples through unchanged', () => {
  assert.deepEqual(shapeUplink(pcm, 'ok'), pcm);
});

test('uplink: silent is zeros of the same length', () => {
  const out = shapeUplink(pcm, 'silent');
  assert.equal(out.length, pcm.length);
  assert.ok(out.every((s) => s === 0));
});

test('uplink: noise is loud, same length, and not the input', () => {
  const big = new Int16Array(1600);
  const out = shapeUplink(big, 'noise');
  assert.equal(out.length, big.length);
  assert.ok(out.some((s) => Math.abs(s) > 16000));
});

test('downlink: ok is the same bytes', () => {
  assert.deepEqual(new Int16Array(/** @type {ArrayBuffer} */ (shapeDownlink(bytesOf(pcm), 'ok'))), pcm);
});

test('downlink: quiet halves every sample', () => {
  const out = new Int16Array(/** @type {ArrayBuffer} */ (shapeDownlink(bytesOf(pcm), 'quiet')));
  assert.deepEqual([...out], [0, 500, -500, 16383, -16384]);
});

test('downlink: silent plays nothing', () => {
  assert.equal(shapeDownlink(bytesOf(pcm), 'silent'), null);
});

test('downlink: noise keeps the length', () => {
  const out = /** @type {ArrayBuffer} */ (shapeDownlink(new ArrayBuffer(3200), 'noise'));
  assert.equal(out.byteLength, 3200);
  assert.ok(new Int16Array(out).some((s) => Math.abs(s) > 16000));
});

test('choices: free ones first, then busy, then unset, each with its note', () => {
  const out = characterChoices([
    { id: 'a', name: 'A', ready: false, online: false },
    { id: 'b', name: 'B', ready: true, online: true },
    { id: 'c', name: 'C', ready: true, online: false },
  ]);
  assert.deepEqual(out, [
    { id: 'c', name: 'C', note: null },
    { id: 'b', name: 'B', note: 'In use by another body' },
    { id: 'a', name: 'A', note: 'Not set up — open the admin page' },
  ]);
});

test('choices: nothing in, nothing out', () => {
  assert.deepEqual(characterChoices([]), []);
});

test('faultText: says what to check, in plain words', () => {
  const tail = ' — check it on the admin page';
  assert.equal(faultText({ part: 'llm', status: 401, kind: 'http' }), `LLM key rejected (401)${tail}`);
  assert.equal(faultText({ part: 'llm', status: 403, kind: 'http' }), `LLM key rejected (403)${tail}`);
  assert.equal(faultText({ part: 'stt', status: 429, kind: 'http' }), `STT is out of quota or rate-limited (429)${tail}`);
  const gone = 'TTS could not be reached — check its address on the admin page';
  assert.equal(faultText({ part: 'tts', status: null, kind: 'timeout' }), gone);
  assert.equal(faultText({ part: 'tts', status: null, kind: 'network' }), gone);
  assert.equal(faultText({ part: 'llm', status: 500, kind: 'http' }), 'LLM failed (HTTP 500)');
  assert.equal(faultText({ part: 'llm', status: null, kind: 'other' }), 'LLM failed');
});

test('adminLink: escapes the id', () => {
  assert.equal(adminLink('a b'), '/#character=a%20b');
});

test('keepsFault: only the user speaking again clears a fault', () => {
  assert.equal(keepsFault('SPEAKING'), true);
  assert.equal(keepsFault('LISTENING'), true);
  assert.equal(keepsFault('CAPTURING'), false);
});

/** @param {string} id @param {string | null} motion @param {boolean} [ready] @param {boolean} [online] */
const row = (id, motion, ready = true, online = false) => ({ id, name: id.toUpperCase(), ready, online, motion });

test('chooseCharacter: one free character connects, whatever it is, for any', () => {
  assert.deepEqual(chooseCharacter([row('a', 'car')], 'any'), { kind: 'connect', id: 'a', name: 'A' });
});

test('chooseCharacter: several free ones are a pick, in choices order', () => {
  const out = chooseCharacter([row('a', 'car', false), row('b', 'car'), row('c', 'pet')], 'any');
  assert.deepEqual(out, { kind: 'pick', choices: [
    { id: 'b', name: 'B', note: null },
    { id: 'c', name: 'C', note: null },
  ] });
});

test('chooseCharacter: for pet, only pets count', () => {
  assert.deepEqual(chooseCharacter([row('a', 'car'), row('p', 'pet')], 'pet'), { kind: 'connect', id: 'p', name: 'P' });
  const two = chooseCharacter([row('a', 'car'), row('p', 'pet'), row('q', 'pet')], 'pet');
  assert.deepEqual(two, { kind: 'pick', choices: [{ id: 'p', name: 'P', note: null }, { id: 'q', name: 'Q', note: null }] });
});

test('chooseCharacter: a ready phone character for the screen recipe is a wrong body, named', () => {
  assert.deepEqual(chooseCharacter([row('a', 'car')], 'pet'), { kind: 'wrong-body', id: 'a', name: 'A', motion: 'car' });
});

test('chooseCharacter: the only suitable one is online, so busy', () => {
  assert.deepEqual(chooseCharacter([row('a', 'car', true, true)], 'any'), { kind: 'busy', id: 'a', name: 'A' });
  assert.deepEqual(chooseCharacter([row('p', 'pet', true, true)], 'pet'), { kind: 'busy', id: 'p', name: 'P' });
});

test('chooseCharacter: pet online + phone ready is busy, not wrong-body', () => {
  assert.deepEqual(chooseCharacter([row('p', 'pet', true, true), row('a', 'car')], 'pet'), { kind: 'busy', id: 'p', name: 'P' });
});

test('chooseCharacter: nothing ready, or nothing at all, is none', () => {
  assert.deepEqual(chooseCharacter([row('a', 'pet', false)], 'pet'), { kind: 'none' });
  assert.deepEqual(chooseCharacter([row('a', null, false)], 'any'), { kind: 'none' });
  assert.deepEqual(chooseCharacter([], 'any'), { kind: 'none' });
});

test('chooseLine words each way a recipe cannot connect', async () => {
  const { chooseLine } = await import('../../sim/body.js');
  const line = (/** @type {any} */ c, /** @type {any} */ n) => /** @type {any} */ (chooseLine(c, n));
  assert.match(line({ kind: 'wrong-body', id: 'a', name: 'Rex', motion: 'wheels' }, 'pet').text, /^Rex is a wheels body, not a pet/);
  assert.match(line({ kind: 'busy', id: 'a', name: 'Rex' }, 'any').text, /^Rex is in use by another body/);
  assert.equal(line({ kind: 'none' }, 'pet').text, 'No pet character yet —');
  assert.match(line({ kind: 'wrong-body', id: 'a', name: 'Asten', motion: 'car' }, 'tarot').text, /set its body to Tarot/);
  assert.equal(line({ kind: 'none' }, 'tarot').text, 'No tarot character yet —');
  assert.equal(line({ kind: 'none' }, 'any').text, 'No characters on this brain yet —');
  assert.equal(line({ kind: 'none' }, 'any').link.href, '/');
  assert.equal(chooseLine({ kind: 'connect', id: 'a', name: 'Rex' }, 'any'), null);
});

test('a toy recipe wants a car body, and says so when the ready one is a pet', () => {
  const pet = { id: 'p', name: 'Pup', ready: true, online: false, motion: 'pet' };
  const car = { id: 'c', name: 'Car', ready: true, online: false, motion: 'car' };
  assert.deepEqual(chooseCharacter([pet, car], 'car'), { kind: 'connect', id: 'c', name: 'Car' });
  assert.deepEqual(chooseCharacter([pet], 'car'), { kind: 'wrong-body', id: 'p', name: 'Pup', motion: 'pet' });
  assert.equal(chooseLine(chooseCharacter([pet], 'car'), 'car')?.text, 'Pup is a pet body, not a car — set its body to Car');
});
