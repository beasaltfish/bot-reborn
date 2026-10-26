// What the reflex tab's controls do to the config, as functions the page can
// test (configurable reflex spec §4). The question is stored as an ordered
// options array (spec §2.1); the JSON view speaks the decision API's own
// `questions` shape, so a question from training can be pasted as is.
import { REFLEX_PRESETS } from '../../core/reflex-presets.js';
import { CAN_DO } from '../../core/config.js';
import { isPlain } from './merge';
import type { Motion, ReflexCall, ReflexConfig, ReflexQuestion, SavedReflex } from './types';

export const DRIVES = ['forward', 'backward'] as const;
export const STEERS = ['left', 'right', 'straight'] as const;

const KIND: Record<ReflexCall['name'], string> = { move: 'move', cruise: 'cruise', stop: 'stop', play_sound: 'sound' };

export function toUnsloth(q: ReflexQuestion): string {
  const criteria = Object.fromEntries(q.options.map((o) => [o.choice, o.description]));
  return JSON.stringify({ [q.name]: { type: 'choice', instructions: q.instructions, criteria } }, null, 2);
}

/**
 * Actions are kept by choice name from `base`, the question as it was when
 * the JSON view opened. Not from the last parse: renaming a key one keystroke
 * at a time passes through names that own nothing, and the actions must still
 * be there when the old name is typed back.
 */
export function fromUnsloth(text: string, base: ReflexQuestion | null):
  { question: ReflexQuestion } | { error: 'jsonInvalid' | 'jsonNotChoice' } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { error: 'jsonInvalid' }; }
  if (!isPlain(parsed) || Object.keys(parsed).length !== 1) return { error: 'jsonNotChoice' };
  const [name, q] = Object.entries(parsed)[0];
  if (!isPlain(q) || q.type !== 'choice' || typeof q.instructions !== 'string' || !isPlain(q.criteria)) {
    return { error: 'jsonNotChoice' };
  }
  const entries = Object.entries(q.criteria);
  if (entries.length < 2 || entries.some(([, d]) => typeof d !== 'string')) return { error: 'jsonNotChoice' };
  const kept = new Map(base?.options.map((o) => [o.choice, o.actions]) ?? []);
  return { question: { name, instructions: q.instructions, options: entries.map(([choice, description]) => (
    { choice, description: description as string, actions: kept.get(choice) ?? [] })) } };
}

export type PresetId = 'none' | 'bark' | 'commands' | 'custom' | `saved:${string}`;

/**
 * By question, as before. A saved one comes first: saving a built-in under a
 * name (with its own threshold, say) is asking to see that name.
 */
export function presetIdOf(r: ReflexConfig, saved: SavedReflex[] = []): PresetId {
  if (!r.question) return 'none';
  const q = JSON.stringify(r.question);
  const mine = saved.find((s) => JSON.stringify(s.question) === q);
  if (mine) return `saved:${mine.name}`;
  const same = REFLEX_PRESETS.find((p) => JSON.stringify(p.question) === q);
  return same ? same.id : 'custom';
}

/** A copy, so editing the character never edits the preset. */
export function presetPatch(id: string, saved: SavedReflex[] = []): Partial<ReflexConfig> {
  if (id === 'none') return { question: null };
  const p = id.startsWith('saved:')
    ? saved.find((s) => s.name === id.slice('saved:'.length))
    : REFLEX_PRESETS.find((x) => x.id === id);
  if (!p) return {};
  return structuredClone({ threshold: p.threshold, state: p.state, question: p.question as ReflexQuestion });
}

/** Spec §4: the kinds this question would fire that this body ignores. */
export function unsupported(r: ReflexConfig, motion: Motion): string[] {
  const can = CAN_DO[motion] ?? CAN_DO.car;
  const names = new Set(r.question?.options.flatMap((o) => o.actions.map((a) => a.name)) ?? []);
  return [...names].filter((n) => !can.includes(KIND[n]));
}

export function freshChoice(q: ReflexQuestion): string {
  const taken = new Set(q.options.map((o) => o.choice));
  let n = q.options.length + 1;
  while (taken.has(`option${n}`)) n++;
  return `option${n}`;
}

/** Two options, because a choice of one is no question. */
export function blankQuestion(): ReflexQuestion {
  return { name: 'action', instructions: '', options: [
    { choice: 'yes', description: '', actions: [] },
    { choice: 'pass', description: '', actions: [] },
  ] };
}
