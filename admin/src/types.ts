export type LayerName = 'stt' | 'llm' | 'tts' | 'reflex';
export type TabName = 'basic' | LayerName;

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

export interface ReflexCall { name: 'move' | 'cruise' | 'stop' | 'play_sound' | 'pose'; args: Record<string, any> }
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

export type Motion = 'car' | 'dry-run' | 'none';

export interface Config {
  stt: LayerConfig;
  llm: LayerConfig;
  tts: LayerConfig;
  reflex: ReflexConfig;
  lang: 'en' | 'zh';
  replyLang: 'zh' | 'en' | null;
  bargeIn: boolean;
  wakeWord: boolean;
  body: { motion: Motion };
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

export interface Summary { id: string; name: string; ready: boolean; online: boolean }
export interface Detail {
  id: string; name: string; token: string; config: Config; endpoints: Endpoint[]; savedReflexes: SavedReflex[]; online: boolean;
}

export interface EditorSlot {
  id: string;
  online: boolean;
  initialTab: TabName;
  onChanged(): void;
  onDeleted(): void;
}
