// The four layers' tests. The brain runs them (server/check-api.js) with the
// adapters the robot itself uses, on the layer as it is on screen; this page
// only shows the answer — and, for TTS, plays it.
import { MATERIAL } from '../../core/checks.js';
import { api } from './api';
import { lang } from './i18n';
import type { Config, LayerName } from './types';

export type CheckFn = (layer: LayerName, config: Config) => Promise<string>;

// Made on the first TTS check, which is a click: a context made before any
// gesture starts suspended, and the line would never be heard.
let ctx: AudioContext | null = null;

async function play(res: Response) {
  ctx ??= new AudioContext();
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  await new Promise<void>((resolve) => { source.onended = () => resolve(); source.start(); });
}

const text = async (res: Response) => ((await res.json()) as { text: string }).text;

export const runCheck: CheckFn = async (layer, config) => {
  const res = await api.check(layer, { config: config[layer], lang });
  if (layer === 'tts') {
    await play(res);
    return MATERIAL[lang].line;
  }
  return layer === 'stt' ? `“${await text(res)}”` : text(res);
};

export type TryFn = (config: Config, heard: string, robotSaid: string) => Promise<string>;
export const runTry: TryFn = async (config, heard, robotSaid) =>
  text(await api.check('reflex', { config: config.reflex, lang, heard, robotSaid }));
