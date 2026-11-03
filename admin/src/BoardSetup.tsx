// Flash a board and set its Wi-Fi and character from this page, over USB
// (board setup spec). The flashing and the serial line are injected so the
// page's logic is tested without hardware.
import { useEffect, useState } from 'react';
import { api } from './api';
import { BoardConsole, ConsoleError, checkWifi, type LinePort } from './boardConsole';
import * as realSerial from './boardSerial';
import { t } from './i18n';
import type { Summary } from './types';

export interface Serial {
  supportsSerial(): boolean;
  openBoard(known?: SerialPort): Promise<LinePort>;
  flashBoard(manifestUrl: string, onProgress: (percent: number) => void): Promise<SerialPort>;
}

type Step = 'idle' | 'flashing' | 'saving' | 'waiting' | 'reading';

export function BoardSetup({ serial = realSerial, replyTimeoutMs }: { serial?: Serial; replyTimeoutMs?: number }) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [mode, setMode] = useState<'flash' | 'settings'>('flash');
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [character, setCharacter] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.list().then((l) => { if (live) setList(l); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, []);

  if (!serial.supportsSerial()) return <p role="alert" className="board-error">{t('boardNeedsChrome')}</p>;

  const busy = step !== 'idle';

  /** Fill the form with what the board holds: name, password, and the character whose token it carries. */
  async function readBoard() {
    setError(null);
    setDone(null);
    setNote(null);
    let port: LinePort | null = null;
    try {
      setStep('reading');
      port = await serial.openBoard();
      const stored = await new BoardConsole(port, { replyTimeoutMs }).readSettings();
      setSsid(stored.ssid);
      setPass(stored.pass);
      // The list holds no tokens: ask for each character's own (never regenerate).
      const details = await Promise.all((list ?? []).map((c) => api.get(c.id)));
      const match = details.find((d) => d.token === stored.token);
      if (match) setCharacter(match.id);
      setNote(match ? t('boardReadDone') : t('boardTokenUnknown'));
    } catch (e) {
      setError(explain(e));
    } finally {
      setStep('idle');
      await port?.close().catch(() => {});
    }
  }

  async function start() {
    setError(null);
    setDone(null);
    const bad = checkWifi(ssid, pass);
    if (bad) return setError(bad === 'bad-ssid' ? t('boardBadSsid') : t('boardBadPass'));
    if (!character) return setError(t('boardNoCharacter'));
    let port: LinePort | null = null;
    try {
      // The token is read, never regenerated: regenerating would disconnect
      // a body already paired with this character.
      const { token } = await api.get(character);
      let flashed: SerialPort | undefined;
      if (mode === 'flash') {
        setStep('flashing');
        setPercent(0);
        flashed = await serial.flashBoard('/firmware/manifest.json', setPercent);
      }
      setStep('saving');
      port = await serial.openBoard(flashed);
      const board = new BoardConsole(port, { replyTimeoutMs });
      await board.setWifi(ssid, pass);
      await board.useDiscovery();
      await board.setToken(token);
      await board.reboot();
      setStep('waiting');
      setDone(await board.waitWelcomed(15000));
    } catch (e) {
      setError(explain(e));
    } finally {
      setStep('idle');
      await port?.close().catch(() => {});
    }
  }

  return (
    <section className="board">
      <h2>{t('boardTitle')}</h2>
      <p>{t('boardIntro')}</p>
      <fieldset disabled={busy}>
        <label><input type="radio" name="board-mode" checked={mode === 'flash'} onChange={() => setMode('flash')} /> {t('boardModeFlash')}</label>
        <label><input type="radio" name="board-mode" checked={mode === 'settings'} onChange={() => setMode('settings')} /> {t('boardModeSettings')}</label>
        <label>{t('boardWifiName')}<input value={ssid} onChange={(e) => setSsid(e.target.value)} autoComplete="off" /></label>
        <label>{t('boardWifiPass')}<input type="text" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
        {list && (
          <label>{t('boardCharacter')}
            <select value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="" />
              {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {mode === 'settings' && <button type="button" onClick={() => void readBoard()}>{t('boardRead')}</button>}
        <button type="button" onClick={() => void start()}>{t('boardStart')}</button>
      </fieldset>
      <p role="status">
        {step === 'flashing' && `${t('boardFlashing')} ${percent}%`}
        {step === 'saving' && t('boardSaving')}
        {step === 'waiting' && t('boardWaiting')}
        {step === 'reading' && t('boardReading')}
        {step === 'idle' && note}
        {done && `${t('boardConnected')}${done}`}
      </p>
      {error && <p role="alert" className="board-error">{error}</p>}
    </section>
  );
}

function explain(e: unknown): string {
  if (e instanceof ConsoleError) {
    switch (e.reason) {
      case 'bad-ssid': return t('boardBadSsid');
      case 'bad-pass': return t('boardBadPass');
      case 'no-reply': return t('boardNoReply');
      case 'rejected': return t('boardRejected') + e.message;
      case 'not-welcomed': return t('boardNotWelcomed');
      default: return t('boardFailed') + e.message;
    }
  }
  // The browser's port chooser, closed without a pick.
  if (e instanceof DOMException && e.name === 'NotFoundError') return t('boardCancelled');
  return t('boardFailed') + (e instanceof Error ? e.message : String(e));
}
