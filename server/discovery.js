// The brain tells the local network where it is, so a body with no `url`
// typed can find it (firmware/main/discover.c asks for this service type).
// Convenience only: if advertising fails the brain still serves.

import { Bonjour } from 'bonjour-service';

/** mDNS service types are at most 15 characters, underscore not counted. */
export const SERVICE_TYPE = 'beasaltfish';
export const BRAIN_HOST = 'beasaltfish-brain.local';

/**
 * @param {{ port: number, name: string, bonjour?: { publish(s: object): unknown, unpublishAll(cb?: () => void): void, destroy(): void } }} opts
 *   `bonjour` is injectable so a test touches no network.
 * @returns {{ stop(): void }}
 */
export function publishBrain({ port, name, bonjour = new Bonjour() }) {
  bonjour.publish({ name, type: SERVICE_TYPE, protocol: 'tcp', port, host: BRAIN_HOST });
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      bonjour.unpublishAll(() => bonjour.destroy());
    },
  };
}

/**
 * publishBrain, kept true: a computer that changes network while the brain
 * runs (Wi-Fi band, a new router, a VPN) has new addresses, and the old
 * announcement would send bodies to one that no longer exists. Every
 * intervalMs the addresses are compared; a change withdraws the old
 * announcement and makes a new one.
 * @param {{ port: number, name: string, addresses: () => string[], intervalMs?: number, makeBonjour?: () => { publish(s: object): unknown, unpublishAll(cb?: () => void): void, destroy(): void } }} opts
 * @returns {{ stop(): void }}
 */
export function keepPublished({ port, name, addresses, intervalMs = 10000, makeBonjour = () => new Bonjour() }) {
  let seen = addresses().join(',');
  let current = publishBrain({ port, name, bonjour: makeBonjour() });
  const timer = setInterval(() => {
    const now = addresses().join(',');
    if (now === seen) return;
    seen = now;
    current.stop();
    current = publishBrain({ port, name, bonjour: makeBonjour() });
  }, intervalMs);
  timer.unref?.();
  return { stop() { clearInterval(timer); current.stop(); } };
}
