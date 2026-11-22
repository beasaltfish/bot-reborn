import type { RunStep } from '../../core/actions.js';

export type LayerName = 'stt' | 'llm' | 'tts' | 'reflex';
export type TabName = 'basic' | 'body' | LayerName;

/** One provider a character talks to, and the key for it. See server/endpoints.js. */
export interface Endpoint {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  custom?: true;
}

export interface LayerConfig {
  /** The entry this layer uses; baseURL and apiKey are copied from it. */
  endpointId?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  voice?: string;
  prompt?: string;
}

/** The action names the reflex editor offers. A candidate list, not a parse
 * guarantee: core/config.js keeps any non-empty name, so `ReflexCall.name` is
 * a plain string and a call outside this list is shown as unsupported. */
export type ReflexKind = 'move' | 'cruise' | 'stop' | 'play_sound' | 'pose' | 'draw_card';
export interface ReflexCall { name: string; args: Record<string, any> }
export interface ReflexOption { choice: string; description: string; actions: ReflexCall[] }
export interface ReflexQuestion { name: string; instructions: string; options: ReflexOption[] }
export interface ReflexConfig extends LayerConfig {
  /** Off keeps the question; the brain just does not ask it. */
  enabled: boolean;
  threshold: number;
  state: string;
  question: ReflexQuestion | null;
}

/** One the admin saved on this character; see server/saved-reflexes.js. */
export interface SavedReflex { name: string; threshold: number; state: string; question: ReflexQuestion }

export type Motion = 'toy' | 'dry-run' | 'none' | 'pet' | 'tarot';

/** One tool a body lets the model call: a name plus a program of verbs. The
 * required fields are the ones `core/bodies.js`'s `Action` requires; the
 * editor's JSON is parsed, not typed, so `bodyProblem` is what refuses it. */
export interface BodyAction {
  name: string;
  label: { en: string; zh: string };
  /** The tool description, straight into the prompt. */
  say: string;
  args?: Record<string, any>;
  run: RunStep[];
  returns?: true;
  rules?: string;
}

export interface BodyTrigger { on: 'shake' | 'button'; action: string }

/** `config.body`: which template this character follows, and what it replaced.
 * Absent keys inherit the template; `actions: null` is the wire form of
 * "remove the override" that the page sends before a reload drops the key. */
export interface BodyConfig {
  /** A template id, or the id of a plugin body (`my-servo`): both are local, so
   * `id` is a plain string. */
  id: string;
  /** The template the body follows — one of the five, or a plugin body's id
   * when the character was built from a plugin card. */
  template?: string;
  label?: { en: string; zh: string };
  prompts?: { voice?: string; rules?: string[] };
  actions?: BodyAction[] | null;
  triggers?: BodyTrigger[] | null;
}

export interface Config {
  stt: LayerConfig;
  llm: LayerConfig;
  tts: LayerConfig;
  reflex: ReflexConfig;
  lang: 'en' | 'zh';
  replyLang: 'zh' | 'en' | null;
  bargeIn: boolean;
  wakeWord: boolean;
  /** Which template of core/bodies.js this character follows; old files said
   * `motion`. */
  body: BodyConfig;
  /** Empty means brain.js's DEFAULT_PERSONA. */
  persona: string;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Patch {
  name?: string;
  config?: DeepPartial<Config>;
  /** The whole list of providers, as it should be after this edit. */
  endpoints?: Endpoint[];
  /** The whole list of saved reflex presets, likewise. */
  savedReflexes?: SavedReflex[];
}

export interface Summary {
  id: string; name: string; ready: boolean; online: boolean;
  /** The resolved template, or a plugin body's id: no reader treats it as a
   * key into `TEMPLATES`, so it is a plain string. */
  motion?: string | null;
  /** Non-secret name for this pairing; absent from older brains. */
  setupId?: string;
  /** The last body admitted in this brain's life; absent when it sent no marker. */
  bodyKind?: 'phone';
  /** First time this brain saw the body connect, ms. Absent until it does. */
  lastSeenAt?: number;
  /** First time this brain sent the body an audible reply, ms. Absent until it does. */
  lastSpokeAt?: number;
}
export interface Detail {
  id: string; name: string; token: string; setupId?: string; config: Config; endpoints: Endpoint[]; savedReflexes: SavedReflex[]; online: boolean;
}

export interface EditorSlot {
  id: string;
  online: boolean;
  initialTab: TabName;
  onChanged(): void;
  onDeleted(): void;
}
