import { describe, expect, it } from 'vitest';
import { keyCopyFor, orderForPicker, pickModel, pickProvider, syncLayers } from './layerEdit';
import { presetById } from '../../core/provider-presets.js';

const blank = { baseURL: '', apiKey: 'k', model: '', voice: '' };

describe('pickProvider', () => {
  it('writes the address and the first model, and keeps the key', () => {
    const { patch, freeModel } = pickProvider('stt', blank, 'groq');
    expect(patch).toEqual({ baseURL: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' });
    expect(freeModel).toBe(false);
  });

  it('keeps a model the new provider also lists', () => {
    const { patch } = pickProvider('stt', { ...blank, model: 'whisper-large-v3' }, 'groq');
    expect(patch.model).toBeUndefined();
  });

  it('replaces a voice that belongs to another model', () => {
    const { patch } = pickProvider('tts', { ...blank, voice: 'nova' }, 'siliconflow');
    expect(patch.voice).toMatch(/^fishaudio\/fish-speech-1\.5:/);
  });

  it('changes nothing for Other', () => {
    expect(pickProvider('llm', blank, 'custom')).toEqual({ patch: {}, freeModel: true });
  });
});

describe('pickModel', () => {
  it('moves the voice along with a model that owns its voices', () => {
    const preset = presetById('tts', 'siliconflow');
    const patch = pickModel(preset, { ...blank, model: 'fishaudio/fish-speech-1.5', voice: 'fishaudio/fish-speech-1.5:alex' }, 'FunAudioLLM/CosyVoice2-0.5B');
    expect(patch).toEqual({ model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'FunAudioLLM/CosyVoice2-0.5B:alex' });
  });
});

describe('syncLayers', () => {
  const base = { baseURL: '', apiKey: '', model: 'm' };
  const config = (over: any = {}) => ({
    stt: { ...base, prompt: '' }, llm: base, tts: { ...base, voice: '' }, reflex: base,
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false, body: { motion: 'car' },
    ...over,
  }) as any;
  const ep = { id: 'ep-1', name: 'Home', baseURL: 'http://10.0.0.5/v1', apiKey: 'k1', custom: true as const };

  it('gives a layer the address and key of the entry it points at', () => {
    const c = config({ llm: { ...base, endpointId: 'ep-1', baseURL: 'http://old', apiKey: '' } });
    expect(syncLayers(c, [ep])).toEqual({ llm: { baseURL: 'http://10.0.0.5/v1', apiKey: 'k1' } });
  });

  it('blanks a layer whose entry is gone, and changes nothing else', () => {
    const c = config({ llm: { ...base, endpointId: 'ep-9', baseURL: 'http://x', apiKey: 'k' }, stt: { ...base, prompt: '' } });
    expect(syncLayers(c, [ep])).toEqual({ llm: { endpointId: '', baseURL: '', apiKey: '' } });
  });
});

describe('keyCopyFor', () => {
  const eps = [
    { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-1' },
    { id: 'ep-1', name: 'Home', baseURL: 'https://api.groq.com/openai/v1/', apiKey: 'other', custom: true as const },
  ];

  it('finds the key another character has for the same address, ignoring a trailing slash', () => {
    expect(keyCopyFor(eps, 'https://api.groq.com/openai/v1')).toBe('gsk-1');
  });

  it('is empty when no entry has that address, or no key', () => {
    expect(keyCopyFor(eps, 'https://api.openai.com/v1')).toBe('');
    expect(keyCopyFor([{ ...eps[0], apiKey: '' }], 'https://api.groq.com/openai/v1')).toBe('');
    expect(keyCopyFor(eps, '')).toBe('');
  });
});

describe('orderForPicker', () => {
  it('sorts by name, keeps each mainland row right after its global twin', () => {
    const rows = [
      { id: 'zhipu', label: 'Zhipu', baseURL: '' },
      { id: 'groq', label: 'Groq', baseURL: '' },
      { id: 'siliconflow-cn', label: 'SiliconFlow', region: 'cn' as const, baseURL: '' },
      { id: 'siliconflow', label: 'SiliconFlow', region: 'global' as const, baseURL: '' },
      { id: 'openai', label: 'OpenAI', baseURL: '' },
    ];
    expect(orderForPicker(rows).map((r) => r.id)).toEqual(['groq', 'openai', 'siliconflow', 'siliconflow-cn', 'zhipu']);
  });
});
