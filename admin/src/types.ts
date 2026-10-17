export type LayerName = 'stt' | 'llm' | 'tts' | 'reflex';
export type TabName = 'basic' | LayerName;

export interface LayerConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  voice?: string;
  prompt?: string;
}

export type Motion = 'car' | 'dry-run' | 'none';

export interface Config {
  stt: LayerConfig;
  llm: LayerConfig;
  tts: LayerConfig;
  reflex: LayerConfig;
  lang: 'en' | 'zh';
  replyLang: 'zh' | 'en' | null;
  bargeIn: boolean;
  wakeWord: boolean;
  body: { motion: Motion };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Patch {
  name?: string;
  config?: DeepPartial<Config>;
}

export interface Summary { id: string; name: string; ready: boolean; online: boolean }
export interface Detail { id: string; name: string; token: string; config: Config; online: boolean }

export interface EditorSlot {
  id: string;
  online: boolean;
  initialTab: TabName;
  onChanged(): void;
  onDeleted(): void;
}
