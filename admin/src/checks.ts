// The four layers' tests. The brain runs them (server/check-api.js) with the
// adapters the robot itself uses, on the layer as it is on screen; this page
// only shows the answer — and, for TTS, plays it.
import { MATERIAL } from '../../core/checks.js';
import { api } from './api';
import { lang } from './i18n';
import type { Config, LayerName } from './types';

export type CheckFn = (layer: LayerName, config: Config) => Promise<string>;

// Made and resumed on the TTS check's click, BEFORE waiting on the brain:
// Safari's activation from that click is gone by the time the audio arrives,
// and a context made then starts suspended and never plays.
let ctx: AudioContext | null = null;

async function play(audio: AudioContext, res: Response) {
  const buffer = await audio.decodeAudioData(await res.arrayBuffer());
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  // `ended` never fires on a context that stayed suspended; the button must
  // come back either way.
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, (buffer.duration + 1) * 1000);
    source.onended = () => { clearTimeout(done); resolve(); };
    source.start();
  });
}

const text = async (res: Response) => ((await res.json()) as { text: string }).text;

export const runCheck: CheckFn = async (layer, config) => {
  const audio = layer === 'tts' ? (ctx ??= new AudioContext()) : null;
  void audio?.resume();
  const res = await api.check(layer, { config: config[layer], lang });
  if (audio) {
    await play(audio, res);
    return MATERIAL[lang].line;
  }
  return layer === 'stt' ? `“${await text(res)}”` : text(res);
};

export type TryFn = (config: Config, heard: string, robotSaid: string) => Promise<string>;
export const runTry: TryFn = async (config, heard, robotSaid) =>
  text(await api.check('reflex', { config: config.reflex, lang, heard, robotSaid }));
