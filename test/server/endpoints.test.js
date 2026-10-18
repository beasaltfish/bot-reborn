// @ts-nocheck: the assertions are the checks here; the shapes are plain JSON.
// Provider entries: what an old character with a key table becomes, and what
// the list will accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEndpoints, endpointsFrom, endpointIdFor, withEndpointIds, MAX_CUSTOM } from '../../server/endpoints.js';

const layer = (baseURL, apiKey = '', extra = {}) => ({ baseURL, apiKey, model: 'm', ...extra });

test('an old character becomes one entry per address its layers use, with its key', () => {
  const config = {
    stt: layer('https://api.groq.com/openai/v1/', ''),
    llm: layer('https://api.groq.com/openai/v1', 'gsk-1'),
    tts: layer('http://10.0.0.5:11434/v1', 'k-home'),
    reflex: layer('', ''),
  };
  const eps = endpointsFrom(config, {});
  const groq = eps.find((e) => e.id === 'groq');
  assert.deepEqual(groq, { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-1' });
  const home = eps.find((e) => e.custom);
  assert.equal(home.baseURL, 'http://10.0.0.5:11434/v1');
  assert.equal(home.name, '10.0.0.5:11434');
  assert.equal(home.apiKey, 'k-home');
  assert.equal(eps.length, 2);
});

test('the key table fills in a key a layer does not have, and keeps an address no layer uses', () => {
  const config = { stt: layer('https://api.groq.com/openai/v1'), llm: layer(''), tts: layer(''), reflex: layer('') };
  const eps = endpointsFrom(config, { 'https://api.groq.com/openai/v1': 'gsk-table', 'https://api.openai.com/v1': 'sk-9' });
  assert.equal(eps.find((e) => e.id === 'groq').apiKey, 'gsk-table');
  assert.equal(eps.find((e) => e.id === 'openai').apiKey, 'sk-9');
});

test('a layer gets the id of its entry, by its address', () => {
  const eps = [{ id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: '' },
    { id: 'ep-1', name: 'Home', baseURL: 'http://10.0.0.5/v1', apiKey: '', custom: true }];
  assert.equal(endpointIdFor('llm', 'https://api.groq.com/openai/v1/', eps), 'groq');
  assert.equal(endpointIdFor('llm', 'http://10.0.0.5/v1', eps), 'ep-1');
  assert.equal(endpointIdFor('llm', 'http://elsewhere/v1', eps), '');
  const out = withEndpointIds({ llm: layer('https://api.groq.com/openai/v1') }, eps);
  assert.equal(out.llm.endpointId, 'groq');
});

test('the list is checked: strings, unique ids, and at most 50 custom', () => {
  const ok = { id: 'ep-1', name: 'Home', baseURL: 'http://x/v1', apiKey: '', custom: true };
  assert.deepEqual(checkEndpoints([ok]), [ok]);
  assert.throws(() => checkEndpoints([{ ...ok, apiKey: 3 }]));
  assert.throws(() => checkEndpoints([ok, ok]), /listed twice/);
  const many = Array.from({ length: MAX_CUSTOM + 1 }, (_, i) => ({ ...ok, id: `ep-${i}` }));
  assert.throws(() => checkEndpoints(many), /at most 50/);
  assert.throws(() => checkEndpoints('nope'));
});
