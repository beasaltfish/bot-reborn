import { describe, expect, it, vi } from 'vitest';
import { runCheck, runTry } from './checks';
import { blankConfig } from './test/fakeApi';
import { lang } from './i18n';
import { MATERIAL } from '../../core/checks.js';

function stubFetch(res: () => Response) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ path: String(input), init });
    return res();
  }));
  return calls;
}

describe('key checks go through the brain', () => {
  it('stt check posts this layer\'s config and the UI language, and quotes the transcript', async () => {
    const calls = stubFetch(() => Response.json({ text: 'go forward' }));
    const config = blankConfig();
    config.stt.apiKey = 'k';
    expect(await runCheck('stt', config)).toBe('“go forward”');
    expect(calls[0].path).toBe('/api/check/stt');
    expect((calls[0].init.headers as Record<string, string>)['X-Bot-Reborn']).toBe('1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ config: config.stt, lang });
  });

  it('tts check plays the returned WAV and returns the line', async () => {
    stubFetch(() => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } }));
    const start = vi.fn();
    const made = vi.fn();
    class FakeContext {
      destination = {};
      constructor() { made(); }
      resume = async () => {};
      decodeAudioData = async () => ({ duration: 0 });
      createBufferSource = () => ({ connect: vi.fn(), start, set onended(f: () => void) { f(); } });
    }
    vi.stubGlobal('AudioContext', FakeContext);
    expect(await runCheck('tts', blankConfig())).toBe(MATERIAL[lang].line);
    expect(made).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalled();
  });

  it('tts check makes and resumes the AudioContext before waiting on the brain', async () => {
    // Safari ends the click's activation while the brain synthesises; a
    // context made after that starts suspended and never plays.
    const order: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      order.push('fetch');
      return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } });
    }));
    class FakeContext {
      destination = {};
      constructor() { order.push('context'); }
      resume = async () => { order.push('resume'); };
      decodeAudioData = async () => ({ duration: 0 });
      createBufferSource = () => ({ connect: vi.fn(), start: vi.fn(), set onended(f: () => void) { f(); } });
    }
    vi.stubGlobal('AudioContext', FakeContext);
    vi.resetModules();
    const fresh = await import('./checks');
    await fresh.runCheck('tts', blankConfig());
    expect(order.slice(0, 3)).toEqual(['context', 'resume', 'fetch']);
  });

  it('a 502 shows the provider error text', async () => {
    stubFetch(() => Response.json({ error: 'TTS 401 Unauthorized: bad key' }, { status: 502 }));
    await expect(runCheck('llm', blankConfig())).rejects.toThrow('TTS 401 Unauthorized: bad key');
  });

  it('runTry sends heard and robotSaid to the reflex check', async () => {
    const calls = stubFetch(() => Response.json({ text: '“hi” → passed' }));
    expect(await runTry(blankConfig(), 'hi', 'Okay!')).toBe('“hi” → passed');
    expect(calls[0].path).toBe('/api/check/reflex');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ heard: 'hi', robotSaid: 'Okay!' });
  });
});
