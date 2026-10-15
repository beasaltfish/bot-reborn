// The AudioWorkletGlobalScope globals. They are not in lib.dom, because they
// exist only inside a worklet — a separate realm with its own scope, its own
// clock, and no DOM at all.
//
// Declared here rather than silenced with @ts-nocheck: the point of checking
// capture-worklet.js is that a resampler is exactly the kind of code where an
// off-by-one in an index goes unnoticed for a long time.

declare const sampleRate: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;
