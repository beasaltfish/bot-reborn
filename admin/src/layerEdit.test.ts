import { describe, expect, it } from 'vitest';
import { pickModel, pickProvider } from './layerEdit';
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
