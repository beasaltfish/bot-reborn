// The way a phone becomes this character's body (server/body split spec §9):
// a code it scans, which opens the page this brain serves with the token in
// the fragment. Plus the one thing the page cannot do for itself — Chrome
// only treats a plain-http LAN address as secure after a flag says so.
import { useEffect, useState } from 'react';
// A namespace import: qrcode is CommonJS, and this form works the same under
// Vite, Vitest and tsc without leaning on synthetic default imports.
import * as QRCode from 'qrcode';
import { api } from './api';
import { t } from './i18n';

const FLAG = 'chrome://flags/#unsafely-treat-insecure-origin-as-secure';

export function PhoneLink({ token }: { token: string }) {
  const [lan, setLan] = useState<{ port: number; addresses: string[] } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let live = true;
    api.lan().then((l) => { if (live) setLan(l); }, () => {});
    return () => { live = false; };
  }, []);

  const address = picked ?? lan?.addresses[0] ?? null;
  const origin = address && lan ? `http://${address}:${lan.port}` : null;
  const url = origin ? `${origin}/phone/#token=${token}` : null;

  useEffect(() => {
    if (!url) return;
    let live = true;
    QRCode.toString(url, { type: 'svg', margin: 1 }).then((s) => { if (live) setSvg(s); }, () => {});
    return () => { live = false; };
  }, [url]);

  if (!lan) return null;
  if (!address || !origin || !url) return <p className="phone">{t('phoneNoNetwork')}</p>;
  return (
    <section className="phone">
      <h3>{t('phoneTitle')}</h3>
      {lan.addresses.length > 1 && (
        <select value={address} onChange={(e) => setPicked(e.target.value)}>
          {lan.addresses.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      <p>{t('phoneScan')}</p>
      {/* The SVG is qrcode's own output for our URL; nothing else goes in. */}
      <div className="qr" data-testid="qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <code className="phone-url">{url}</code>
      <p>
        {t('phoneFlag')} <code>{FLAG}</code>{t('phoneFlagThen')}
      </p>
      <code>{origin}</code>
    </section>
  );
}
